import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { domains } from "./domains";

// ─── API Tokens ────────────────────────────────────────────────────────────

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(), // e.g. "em_sk_a1b2c3"
  permissions: text("permissions").notNull(), // JSON: ["read:messages"]
  domainId: text("domain_id").references(() => domains.id, {
    onDelete: "cascade",
  }), // nullable — null = all domains
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
