import { Hono } from "hono";
import { eq, and, desc, like, count, or } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import {
  messages,
  messageRecipients,
  messageDeliveries,
  attachments,
} from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { sanitizeHtml } from "../lib/html-sanitize";

const messagesRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

messagesRouter.use("/*", requireAuth);

/**
 * GET /api/messages
 * List messages for a mailbox.
 * Query params: mailboxId (required), folder (inbox|sent), page, limit, search.
 */
messagesRouter.get("/", async (c) => {
  const db = c.get("db");
  const mailboxId = c.req.query("mailboxId");
  const folder = (c.req.query("folder") || "inbox") as "inbox" | "sent";
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const search = c.req.query("search");

  if (!mailboxId) {
    return c.json({ error: "mailboxId is required" }, 400);
  }

  const offset = (page - 1) * limit;

  const conditions = [
    eq(messageDeliveries.mailboxId, mailboxId),
    eq(messageDeliveries.folder, folder),
  ];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        like(messages.subject, pattern),
        like(messages.fromAddress, pattern),
        like(messages.fromName, pattern),
      )!,
    );
  }

  const baseQuery = db
    .select({
      id: messages.id,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      subject: messages.subject,
      isRead: messageDeliveries.isRead,
      createdAt: messages.createdAt,
      deliveryStatus: messages.deliveryStatus,
      deliveryId: messageDeliveries.id,
    })
    .from(messageDeliveries)
    .innerJoin(messages, eq(messageDeliveries.messageId, messages.id))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);

  const data = await baseQuery;

  const result = await Promise.all(
    data.map(async (msg) => {
      const attCount = await db
        .select({ value: count() })
        .from(attachments)
        .where(eq(attachments.messageId, msg.id))
        .then((rows) => rows[0]?.value ?? 0);

      return {
        id: msg.id,
        fromAddress: msg.fromAddress,
        fromName: msg.fromName,
        subject: msg.subject,
        isRead: msg.isRead,
        hasAttachments: attCount > 0,
        deliveryStatus: msg.deliveryStatus,
        createdAt: msg.createdAt,
      };
    }),
  );

  const totalResult = await db
    .select({ value: count() })
    .from(messageDeliveries)
    .innerJoin(messages, eq(messageDeliveries.messageId, messages.id))
    .where(and(...conditions));
  const total = totalResult[0]?.value ?? 0;

  return c.json({ data: result, total, page, limit });
});

/**
 * GET /api/messages/:id
 * Get message details including parsed body, recipients, and attachments.
 */
messagesRouter.get("/:id", async (c) => {
  const db = c.get("db");
  const { id } = c.req.param();

  const message = await db
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1)
    .then((rows) => rows[0]);

  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  const recipients = await db
    .select({
      address: messageRecipients.address,
      type: messageRecipients.type,
    })
    .from(messageRecipients)
    .where(eq(messageRecipients.messageId, id));

  const atts = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      size: attachments.size,
    })
    .from(attachments)
    .where(eq(attachments.messageId, id));

  const delivery = await db
    .select({ isRead: messageDeliveries.isRead })
    .from(messageDeliveries)
    .where(eq(messageDeliveries.messageId, id))
    .limit(1)
    .then((rows) => rows[0]);

  // Belt-and-braces: sanitize on read even though inbound already did so,
  // so messages written before P0-4 are still safe to render.
  const safeHtml = await sanitizeHtml(message.htmlBody);

  return c.json({
    data: {
      id: message.id,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      subject: message.subject,
      textBody: message.textBody,
      htmlBody: safeHtml,
      isRead: delivery?.isRead ?? false,
      hasAttachments: atts.length > 0,
      deliveryStatus: message.deliveryStatus,
      deliveryError: message.deliveryError,
      createdAt: message.createdAt,
      recipients,
      attachments: atts,
    },
  });
});

/**
 * PATCH /api/messages/:id
 * Update message (mark as read/unread).
 * Body: { isRead: boolean, mailboxId: string }
 */
messagesRouter.patch("/:id", async (c) => {
  const db = c.get("db");
  const { id } = c.req.param();
  const body = await c.req.json<{ isRead?: boolean; mailboxId?: string }>();

  const conditions = [eq(messageDeliveries.messageId, id)];
  if (body.mailboxId) {
    conditions.push(eq(messageDeliveries.mailboxId, body.mailboxId));
  }

  const delivery = await db
    .select()
    .from(messageDeliveries)
    .where(and(...conditions))
    .limit(1)
    .then((rows) => rows[0]);

  if (!delivery) {
    return c.json({ error: "Message delivery not found" }, 404);
  }

  if (body.isRead !== undefined) {
    await db
      .update(messageDeliveries)
      .set({ isRead: body.isRead })
      .where(eq(messageDeliveries.id, delivery.id));
  }

  return c.json({ message: "Message updated successfully" });
});

/**
 * GET /api/messages/:id/attachments/:attachmentId
 * Download an attachment from R2.
 */
messagesRouter.get("/:id/attachments/:attachmentId", async (c) => {
  const db = c.get("db");
  const { id, attachmentId } = c.req.param();

  const attachment = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.messageId, id),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (!attachment) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  const object = await c.env.STORAGE.get(attachment.r2Key);

  if (!object) {
    return c.json({ error: "Attachment file not found in storage" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename="${attachment.filename}"`,
      "Content-Length": attachment.size.toString(),
    },
  });
});

export default messagesRouter;
