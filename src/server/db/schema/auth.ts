import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ─── Users ──────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // nanoid
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Algorithm used to derive `password_hash`. NULL / absent = legacy HMAC.
  // New accounts write "pbkdf2-sha256-310k"; legacy hashes are re-hashed to
  // PBKDF2 on next successful login.
  passwordAlgo: text("password_algo"),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["admin"] }).notNull().default("admin"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ─── Sessions ───────────────────────────────────────────────────────────────

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // nanoid
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
