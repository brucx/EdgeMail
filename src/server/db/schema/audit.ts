import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

// ─── Audit Logs ─────────────────────────────────────────────────────────────

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), // nanoid
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g. "domain.create", "mailbox.delete", "email.send"
  resourceType: text("resource_type").notNull(), // e.g. "domain", "mailbox", "message"
  resourceId: text("resource_id"),
  details: text("details"), // JSON string for additional context
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
