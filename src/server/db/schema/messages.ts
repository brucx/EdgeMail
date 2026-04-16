import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { mailboxes } from "./domains";

// ─── Messages ───────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(), // nanoid
    messageId: text("message_id").unique(), // RFC 822 Message-ID header
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    rawKey: text("raw_key"), // R2 key: raw/{id}.eml
    size: integer("size").notNull().default(0), // bytes
    // Outbound delivery state (populated by the Resend webhook).
    // NULL for inbound mail. Values: "sent" | "delivered" | "bounced" |
    // "complained" | "delivery_delayed" | "failed".
    deliveryStatus: text("delivery_status"),
    deliveryError: text("delivery_error"),
    deliveryUpdatedAt: text("delivery_updated_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    // Speeds up sent-folder and retention scans.
    createdAtIdx: index("messages_created_at_idx").on(t.createdAt),
  }),
);

// ─── Message Recipients ─────────────────────────────────────────────────────

export const messageRecipients = sqliteTable("message_recipients", {
  id: text("id").primaryKey(), // nanoid
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  type: text("type", { enum: ["to", "cc", "bcc"] }).notNull(),
});

// ─── Message Deliveries ─────────────────────────────────────────────────────
// One message can be delivered to multiple mailboxes (via alias/group routing)

export const messageDeliveries = sqliteTable(
  "message_deliveries",
  {
    id: text("id").primaryKey(), // nanoid
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    folder: text("folder", { enum: ["inbox", "sent"] }).notNull().default("inbox"),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    deliveredAt: text("delivered_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    // Matches the main message-list query shape.
    mailboxFolderIdx: index("message_deliveries_mailbox_folder_idx").on(
      t.mailboxId,
      t.folder,
    ),
  }),
);

// ─── Attachments ────────────────────────────────────────────────────────────

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(), // nanoid
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull().default(0), // bytes
  r2Key: text("r2_key").notNull(), // attachments/{messageId}/{id}/{filename}
});
