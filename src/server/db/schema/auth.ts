import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
  // Optional TOTP second factor. Secret is AES-GCM ciphertext; backup codes
  // are a JSON array of SHA-256(code) hashes. Both are only touched when the
  // user explicitly enables 2FA.
  totpEnabled: integer("totp_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  totpSecretEnc: text("totp_secret_enc"),
  backupCodesEnc: text("backup_codes_enc"),
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

// ─── Pending 2FA Challenges ─────────────────────────────────────────────────
// Short-lived row created after password verify when the account has 2FA;
// exchanged for a real session by POST /api/auth/2fa/verify.

export const pending2fa = sqliteTable("pending_2fa", {
  id: text("id").primaryKey(), // nanoid; also the client-held token
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
