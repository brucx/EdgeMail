import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import type { Env, AppVariables } from "../env";
import { mailboxes, messages, messageRecipients, messageDeliveries, auditLogs } from "../db/schema";
import { generateId } from "../lib/id";
import { requireAuth } from "../middleware/auth";
import { sendEmailSchema } from "@shared/types";

const sendRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

sendRouter.use("/*", requireAuth);

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

    // Send via Resend
    const resend = new Resend(c.env.RESEND_API_KEY);

    try {
      const result = await resend.emails.send({
        from,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        html: html || undefined,
        text: text || undefined,
      });

      if (result.error) {
        console.error("[EdgeMail] Resend error:", result.error);
        return c.json({ error: `Failed to send email: ${result.error.message}` }, 502);
      }

      // Store sent message in D1
      const messageId = generateId();
      await db.insert(messages).values({
        id: messageId,
        messageId: result.data?.id || null,
        fromAddress: from,
        fromName: senderMailbox.displayName,
        subject,
        textBody: text || null,
        htmlBody: html || null,
        size: (text?.length || 0) + (html?.length || 0),
      });

      // Store recipients
      for (const addr of to) {
        await db.insert(messageRecipients).values({
          id: generateId(),
          messageId,
          address: addr,
          type: "to",
        });
      }
      if (cc) {
        for (const addr of cc) {
          await db.insert(messageRecipients).values({
            id: generateId(),
            messageId,
            address: addr,
            type: "cc",
          });
        }
      }
      if (bcc) {
        for (const addr of bcc) {
          await db.insert(messageRecipients).values({
            id: generateId(),
            messageId,
            address: addr,
            type: "bcc",
          });
        }
      }

      // Create delivery record in sent folder
      await db.insert(messageDeliveries).values({
        id: generateId(),
        messageId,
        mailboxId: senderMailbox.id,
        folder: "sent",
        isRead: true,
      });

      // Audit log
      await db.insert(auditLogs).values({
        id: generateId(),
        userId: c.get("userId"),
        action: "email.send",
        resourceType: "message",
        resourceId: messageId,
        details: JSON.stringify({ from, to, subject }),
      });

      return c.json({
        data: { id: messageId, resendId: result.data?.id },
        message: "Email sent successfully",
      });
    } catch (err) {
      console.error("[EdgeMail] Send error:", err);
      return c.json({ error: "Failed to send email" }, 500);
    }
  },
);

export default sendRouter;
