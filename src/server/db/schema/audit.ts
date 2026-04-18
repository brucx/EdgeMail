import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { apiTokens } from "./tokens";

// ─── Audit Logs ─────────────────────────────────────────────────────────────

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(), // nanoid
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  // Populated when the action was driven by an API token (send.ts currently
  // the only such path). `userId` is null in that case, so without this
  // column the log would be unattributable. `set null` on delete preserves
  // the log row if the token is later revoked.
  apiTokenId: text("api_token_id").references(() => apiTokens.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(), // e.g. "domain.create", "mailbox.delete", "email.send"
  resourceType: text("resource_type").notNull(), // e.g. "domain", "mailbox", "message"
  resourceId: text("resource_id"),
  details: text("details"), // JSON string for additional context
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
