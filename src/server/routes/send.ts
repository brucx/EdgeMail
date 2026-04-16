import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
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
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { decryptSecret } from "../lib/crypto";
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
 * POST /api/send
 * Send an email via Resend.
 * Body: { from, to, cc?, bcc?, subject, html?, text? }
 */
sendRouter.post(
  "/",
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

    // Resolve Resend API key: per-domain override > global fallback.
    let resendApiKey = c.env.RESEND_API_KEY;
    const senderDomain = await db
      .select()
      .from(domains)
      .where(eq(domains.id, senderMailbox.domainId))
      .limit(1)
      .then((rows) => rows[0]);

    if (senderDomain?.resendApiKey) {
      if (!c.env.ENCRYPTION_KEY) {
        log.error("ENCRYPTION_KEY missing; cannot decrypt per-domain Resend key");
        return c.json(
          { error: "Server is misconfigured: ENCRYPTION_KEY is required to use per-domain Resend keys" },
          500,
        );
      }
      try {
        resendApiKey = await decryptSecret(senderDomain.resendApiKey, c.env);
      } catch (err) {
        log.error("failed to decrypt per-domain Resend key", { err });
        return c.json(
          { error: "Failed to decrypt per-domain Resend key. Re-save it in the domain settings." },
          500,
        );
      }
    }

    if (!resendApiKey) {
      return c.json(
        { error: "No Resend API key is configured for this domain or globally" },
        500,
      );
    }

    const resend = new Resend(resendApiKey);

    try {
      // Resend's typed overloads require either `html`, `text`, or `react`
      // to be present. Zod already ensures at least one is a non-empty
      // string at the schema level; the cast keeps the type narrow.
      const result = await resend.emails.send({
        from,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        html: html || undefined,
        text: text || undefined,
      } as Parameters<typeof resend.emails.send>[0]);

      if (result.error) {
        log.error("Resend send rejected", { err: result.error });
        return c.json({ error: `Failed to send email: ${result.error.message}` }, 502);
      }

      // Store sent message in D1 (batch for atomicity)
      const messageId = generateId();
      const recipientRows = [
        ...to.map((addr) => ({ id: generateId(), messageId, address: addr, type: "to" as const })),
        ...(cc ?? []).map((addr) => ({ id: generateId(), messageId, address: addr, type: "cc" as const })),
        ...(bcc ?? []).map((addr) => ({ id: generateId(), messageId, address: addr, type: "bcc" as const })),
      ];

      const stmts = [
        db.insert(messages).values({
          id: messageId,
          messageId: result.data?.id || null,
          fromAddress: from,
          fromName: senderMailbox.displayName,
          subject,
          textBody: text || null,
          htmlBody: html || null,
          size: (text?.length || 0) + (html?.length || 0),
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
          details: JSON.stringify({ from, to, subject }),
        }),
      ];

      await db.batch(stmts as unknown as [typeof stmts[number], ...typeof stmts]);

      log.info("email sent", { messageId, resendId: result.data?.id, to: to.length });

      return c.json({
        data: { id: messageId, resendId: result.data?.id },
        message: "Email sent successfully",
      });
    } catch (err) {
      log.error("send error", { err });
      return c.json({ error: "Failed to send email" }, 500);
    }
  },
);

export default sendRouter;
