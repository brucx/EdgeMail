import { Hono } from "hono";
import { eq, and, desc, like, sql, count } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import {
  messages,
  messageRecipients,
  messageDeliveries,
  attachments,
} from "../db/schema";
import { requireAuth } from "../middleware/auth";

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
  const folder = c.req.query("folder") || "inbox";
  const page = parseInt(c.req.query("page") || "1", 10);
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const search = c.req.query("search");

  if (!mailboxId) {
    return c.json({ error: "mailboxId is required" }, 400);
  }

  const offset = (page - 1) * limit;

  // Build conditions
  const conditions = [
    eq(messageDeliveries.mailboxId, mailboxId),
    eq(messageDeliveries.folder, folder),
  ];

  // Base query: messages joined with deliveries
  let baseQuery = db
    .select({
      id: messages.id,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      subject: messages.subject,
      isRead: messageDeliveries.isRead,
      createdAt: messages.createdAt,
      deliveryId: messageDeliveries.id,
    })
    .from(messageDeliveries)
    .innerJoin(messages, eq(messageDeliveries.messageId, messages.id))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);

  const data = await baseQuery;

  // Augment with hasAttachments for each message
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
        createdAt: msg.createdAt,
      };
    }),
  );

  // Optional search filter (done post-query for simplicity with D1)
  let filtered = result;
  if (search) {
    const s = search.toLowerCase();
    filtered = result.filter(
      (msg) =>
        msg.subject?.toLowerCase().includes(s) ||
        msg.fromAddress.toLowerCase().includes(s) ||
        msg.fromName?.toLowerCase().includes(s),
    );
  }

  // Get total count
  const totalResult = await db
    .select({ value: count() })
    .from(messageDeliveries)
    .where(and(...conditions));
  const total = totalResult[0]?.value ?? 0;

  return c.json({ data: filtered, total, page, limit });
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

  // Get recipients
  const recipients = await db
    .select({
      address: messageRecipients.address,
      type: messageRecipients.type,
    })
    .from(messageRecipients)
    .where(eq(messageRecipients.messageId, id));

  // Get attachments
  const atts = await db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      size: attachments.size,
    })
    .from(attachments)
    .where(eq(attachments.messageId, id));

  // Get read status from delivery (if applicable)
  const delivery = await db
    .select({ isRead: messageDeliveries.isRead })
    .from(messageDeliveries)
    .where(eq(messageDeliveries.messageId, id))
    .limit(1)
    .then((rows) => rows[0]);

  return c.json({
    data: {
      id: message.id,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      subject: message.subject,
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      isRead: delivery?.isRead ?? false,
      hasAttachments: atts.length > 0,
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

  // Find the delivery record
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

  // Find the attachment
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

  // Stream from R2
  const object = await c.env.STORAGE.get(attachment.r2Key);

  if (!object) {
    return c.json({ error: "Attachment file not found in storage" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${attachment.filename}"`,
      "Content-Length": attachment.size.toString(),
    },
  });
});

export default messagesRouter;
