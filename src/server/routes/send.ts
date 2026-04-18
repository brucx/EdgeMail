import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import {
  mailboxes,
  messages,
  messageRecipients,
  messageDeliveries,
  auditLogs,
  domains,
} from "../db/schema";
import { generateId } from "../lib/id";
import { requireAuth, requirePermission } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { resolveMailer, MailerError } from "../services/mailer";
import { getSendCapabilities } from "../services/mailer/capabilities";
import { sendEmailSchema } from "@shared/types";

const sendRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

sendRouter.use("/*", requireAuth);

// Two stacked limiters: a short burst cap (30/minute) and a long daily cap
// (500/day). Keyed on the sender address since that maps 1:1 to a mailbox.
sendRouter.use(
  "/*",
  rateLimit({
    bucket: "send-burst",
    max: 30,
    windowSec: 60,
    keyFn: async (c) => {
      try {
        const body = await c.req.raw.clone().json<{ from?: string }>();
        return body.from ?? null;
      } catch {
        return null;
      }
    },
  }),
);
sendRouter.use(
  "/*",
  rateLimit({
    bucket: "send-daily",
    max: 500,
    windowSec: 86_400,
    keyFn: async (c) => {
      try {
        const body = await c.req.raw.clone().json<{ from?: string }>();
        return body.from ?? null;
      } catch {
        return null;
      }
    },
  }),
);

/**
 * GET /api/send/capabilities
 *
 * Advisory summary of which outbound providers look ready. Drives the UI
 * "Sending status" card so operators see guidance (upgrade to Paid, add a
 * Resend key, onboard the domain, etc.) before they hit a send failure.
 *
 * Not authoritative — the real source of truth is POST /api/send.
 */
sendRouter.get("/capabilities", async (c) => {
  const db = c.get("db");
  // Count sends since UTC midnight (matches CF's reset boundary). D1 stores
  // `messages.createdAt` as an ISO datetime string, so a lexical >= compare
  // against `YYYY-MM-DD 00:00:00` works correctly.
  const utcMidnight = new Date();
  utcMidnight.setUTCHours(0, 0, 0, 0);
  const utcMidnightStr = utcMidnight.toISOString().slice(0, 19).replace("T", " ");

  const [perDomainKeyCount, domainRows, cloudflareSentToday, resendSentToday] =
    await Promise.all([
      db
        .select({ n: sql<number>`count(*)` })
        .from(domains)
        .where(isNotNull(domains.resendApiKey))
        .then((rows) => Number(rows[0]?.n ?? 0)),
      db.select({ domain: domains.domain }).from(domains),
      db
        .select({ n: sql<number>`count(*)` })
        .from(messages)
        .where(
          and(
            eq(messages.provider, "cloudflare"),
            gte(messages.createdAt, utcMidnightStr),
          ),
        )
        .then((rows) => Number(rows[0]?.n ?? 0)),
      db
        .select({ n: sql<number>`count(*)` })
        .from(messages)
        .where(
          and(
            eq(messages.provider, "resend"),
            gte(messages.createdAt, utcMidnightStr),
          ),
        )
        .then((rows) => Number(rows[0]?.n ?? 0)),
    ]);

  const caps = await getSendCapabilities(
    c.env,
    perDomainKeyCount,
    domainRows.map((r) => r.domain),
    cloudflareSentToday,
    resendSentToday,
  );
  return c.json({ data: caps });
});

/**
 * POST /api/send
 * Send an email through the mailer (Resend or Cloudflare Email Service,
 * picked per-domain by services/mailer/resolveMailer).
 *
 * Body: { from, to, cc?, bcc?, subject, html?, text? }
 */
sendRouter.post(
  "/",
  requirePermission("send:messages"),
  zValidator("json", sendEmailSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const log = c.get("logger");
    const { from, to, cc, bcc, subject, html, text } = c.req.valid("json");

    // Validate sender address — must be an existing mailbox with canSend=true
    const senderMailbox = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.address, from))
      .limit(1)
      .then((rows) => rows[0]);

    if (!senderMailbox) {
      return c.json({ error: `Sender address ${from} is not a registered mailbox` }, 403);
    }

    if (!senderMailbox.canSend) {
      return c.json({ error: `Mailbox ${from} is not authorized to send emails` }, 403);
    }

    const senderDomain = await db
      .select()
      .from(domains)
      .where(eq(domains.id, senderMailbox.domainId))
      .limit(1)
      .then((rows) => rows[0]);

    let mailer;
    try {
      mailer = await resolveMailer(c.env, {
        senderProvider: senderDomain?.senderProvider ?? null,
        resendApiKey: senderDomain?.resendApiKey ?? null,
      });
    } catch (err) {
      if (err instanceof MailerError) {
        log.error("mailer resolution failed", { err: err.message, provider: err.provider });
        return c.json({ error: err.message }, err.userVisible ? 400 : 500);
      }
      throw err;
    }

    let result;
    try {
      result = await mailer.send({
        from,
        fromName: senderMailbox.displayName,
        to,
        cc,
        bcc,
        subject,
        html,
        text,
      });
    } catch (err) {
      if (err instanceof MailerError) {
        // Pass the Error object itself so the logger's Error serializer
        // preserves stack trace & nested cause for Workers Tail.
        log.error("mailer send rejected", { provider: err.provider, err });
        return c.json({ error: `Failed to send email: ${err.message}` }, 502);
      }
      log.error("send error (unexpected)", { err });
      return c.json({ error: "Failed to send email" }, 500);
    }

    // Persist sent message and recipient/delivery rows in a single batch.
    const messageId = generateId();
    const recipientRows = [
      ...to.map((addr) => ({ id: generateId(), messageId, address: addr, type: "to" as const })),
      ...(cc ?? []).map((addr) => ({ id: generateId(), messageId, address: addr, type: "cc" as const })),
      ...(bcc ?? []).map((addr) => ({ id: generateId(), messageId, address: addr, type: "bcc" as const })),
    ];

    const stmts = [
      db.insert(messages).values({
        id: messageId,
        messageId: result.providerMessageId,
        fromAddress: from,
        fromName: senderMailbox.displayName,
        subject,
        textBody: text || null,
        htmlBody: html || null,
        size: (text?.length || 0) + (html?.length || 0),
        deliveryStatus: "sent",
        deliveryUpdatedAt: new Date().toISOString(),
        provider: result.provider,
      }),
      ...recipientRows.map((row) => db.insert(messageRecipients).values(row)),
      db.insert(messageDeliveries).values({
        id: generateId(),
        messageId,
        mailboxId: senderMailbox.id,
        folder: "sent",
        isRead: true,
      }),
      db.insert(auditLogs).values({
        id: generateId(),
        userId: c.get("userId"),
        action: "email.send",
        resourceType: "message",
        resourceId: messageId,
        details: JSON.stringify({ from, to, subject, provider: result.provider }),
      }),
    ];

    await db.batch(stmts as unknown as [typeof stmts[number], ...typeof stmts]);

    log.info("email sent", {
      messageId,
      providerMessageId: result.providerMessageId,
      provider: result.provider,
      to: to.length,
    });

    return c.json({
      data: {
        id: messageId,
        providerMessageId: result.providerMessageId,
        provider: result.provider,
      },
      message: "Email sent successfully",
    });
  },
);

export default sendRouter;
