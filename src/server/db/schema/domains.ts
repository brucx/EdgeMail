import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Domains ────────────────────────────────────────────────────────────────

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(), // nanoid
  domain: text("domain").notNull().unique(),
  status: text("status", { enum: ["pending", "active", "disabled"] })
    .notNull()
    .default("pending"),
  mxVerified: integer("mx_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Mailboxes ──────────────────────────────────────────────────────────────

export const mailboxes = sqliteTable("mailboxes", {
  id: text("id").primaryKey(), // nanoid
  address: text("address").notNull().unique(), // full address: user@domain.com
  domainId: text("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  canSend: integer("can_send", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Aliases ────────────────────────────────────────────────────────────────

export const aliases = sqliteTable("aliases", {
  id: text("id").primaryKey(), // nanoid
  address: text("address").notNull().unique(), // full address: alias@domain.com
  domainId: text("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
  allowSendAs: integer("allow_send_as", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Alias Targets ──────────────────────────────────────────────────────────

export const aliasTargets = sqliteTable("alias_targets", {
  id: text("id").primaryKey(), // nanoid
  aliasId: text("alias_id")
    .notNull()
    .references(() => aliases.id, { onDelete: "cascade" }),
  targetMailboxId: text("target_mailbox_id")
    .notNull()
    .references(() => mailboxes.id, { onDelete: "cascade" }),
});

// ─── Groups ─────────────────────────────────────────────────────────────────

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(), // nanoid
  address: text("address").notNull().unique(), // full address: group@domain.com
  domainId: text("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  allowSendAs: integer("allow_send_as", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Group Members ──────────────────────────────────────────────────────────

export const groupMembers = sqliteTable("group_members", {
  id: text("id").primaryKey(), // nanoid
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id, { onDelete: "cascade" }),
  mailboxId: text("mailbox_id")
    .notNull()
    .references(() => mailboxes.id, { onDelete: "cascade" }),
});
