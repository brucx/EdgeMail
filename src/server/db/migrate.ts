/**
 * Auto-migration: creates all tables if they don't exist.
 * Uses IF NOT EXISTS so it's safe to run on every cold start.
 * Generated from drizzle/0000_volatile_wasp.sql.
 */

const MIGRATION_STATEMENTS = [
  // Users (must come before sessions and audit_logs)
  `CREATE TABLE IF NOT EXISTS \`users\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`email\` text NOT NULL,
    \`password_hash\` text NOT NULL,
    \`display_name\` text NOT NULL,
    \`role\` text DEFAULT 'admin' NOT NULL,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    \`updated_at\` text DEFAULT (datetime('now')) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`users_email_unique\` ON \`users\` (\`email\`)`,

  // Sessions
  `CREATE TABLE IF NOT EXISTS \`sessions\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`user_id\` text NOT NULL,
    \`token\` text NOT NULL,
    \`expires_at\` text NOT NULL,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`sessions_token_unique\` ON \`sessions\` (\`token\`)`,

  // Domains (must come before mailboxes, aliases, groups)
  `CREATE TABLE IF NOT EXISTS \`domains\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`domain\` text NOT NULL,
    \`status\` text DEFAULT 'pending' NOT NULL,
    \`mx_verified\` integer DEFAULT false NOT NULL,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    \`updated_at\` text DEFAULT (datetime('now')) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`domains_domain_unique\` ON \`domains\` (\`domain\`)`,

  // Mailboxes
  `CREATE TABLE IF NOT EXISTS \`mailboxes\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`address\` text NOT NULL,
    \`domain_id\` text NOT NULL,
    \`display_name\` text NOT NULL,
    \`can_send\` integer DEFAULT true NOT NULL,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    \`updated_at\` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (\`domain_id\`) REFERENCES \`domains\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`mailboxes_address_unique\` ON \`mailboxes\` (\`address\`)`,

  // Aliases
  `CREATE TABLE IF NOT EXISTS \`aliases\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`address\` text NOT NULL,
    \`domain_id\` text NOT NULL,
    \`allow_send_as\` integer DEFAULT false NOT NULL,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    \`updated_at\` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (\`domain_id\`) REFERENCES \`domains\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`aliases_address_unique\` ON \`aliases\` (\`address\`)`,

  // Alias targets
  `CREATE TABLE IF NOT EXISTS \`alias_targets\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`alias_id\` text NOT NULL,
    \`target_mailbox_id\` text NOT NULL,
    FOREIGN KEY (\`alias_id\`) REFERENCES \`aliases\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`target_mailbox_id\`) REFERENCES \`mailboxes\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,

  // Groups
  `CREATE TABLE IF NOT EXISTS \`groups\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`address\` text NOT NULL,
    \`domain_id\` text NOT NULL,
    \`display_name\` text NOT NULL,
    \`allow_send_as\` integer DEFAULT false NOT NULL,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    \`updated_at\` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (\`domain_id\`) REFERENCES \`domains\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`groups_address_unique\` ON \`groups\` (\`address\`)`,

  // Group members
  `CREATE TABLE IF NOT EXISTS \`group_members\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`group_id\` text NOT NULL,
    \`mailbox_id\` text NOT NULL,
    FOREIGN KEY (\`group_id\`) REFERENCES \`groups\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`mailbox_id\`) REFERENCES \`mailboxes\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,

  // Messages
  `CREATE TABLE IF NOT EXISTS \`messages\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`message_id\` text,
    \`from_address\` text NOT NULL,
    \`from_name\` text,
    \`subject\` text,
    \`text_body\` text,
    \`html_body\` text,
    \`raw_key\` text,
    \`size\` integer DEFAULT 0 NOT NULL,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS \`messages_message_id_unique\` ON \`messages\` (\`message_id\`)`,

  // Message recipients
  `CREATE TABLE IF NOT EXISTS \`message_recipients\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`message_id\` text NOT NULL,
    \`address\` text NOT NULL,
    \`type\` text NOT NULL,
    FOREIGN KEY (\`message_id\`) REFERENCES \`messages\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,

  // Message deliveries
  `CREATE TABLE IF NOT EXISTS \`message_deliveries\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`message_id\` text NOT NULL,
    \`mailbox_id\` text NOT NULL,
    \`folder\` text DEFAULT 'inbox' NOT NULL,
    \`is_read\` integer DEFAULT false NOT NULL,
    \`delivered_at\` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (\`message_id\`) REFERENCES \`messages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`mailbox_id\`) REFERENCES \`mailboxes\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,

  // Attachments
  `CREATE TABLE IF NOT EXISTS \`attachments\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`message_id\` text NOT NULL,
    \`filename\` text NOT NULL,
    \`mime_type\` text NOT NULL,
    \`size\` integer DEFAULT 0 NOT NULL,
    \`r2_key\` text NOT NULL,
    FOREIGN KEY (\`message_id\`) REFERENCES \`messages\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,

  // API tokens
  `CREATE TABLE IF NOT EXISTS \`api_tokens\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`name\` text NOT NULL,
    \`token_hash\` text NOT NULL,
    \`prefix\` text NOT NULL,
    \`permissions\` text NOT NULL,
    \`domain_id\` text,
    \`last_used_at\` text,
    \`expires_at\` text,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    \`updated_at\` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (\`domain_id\`) REFERENCES \`domains\`(\`id\`) ON UPDATE no action ON DELETE cascade
  )`,

  // Audit logs
  `CREATE TABLE IF NOT EXISTS \`audit_logs\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`user_id\` text,
    \`action\` text NOT NULL,
    \`resource_type\` text NOT NULL,
    \`resource_id\` text,
    \`details\` text,
    \`created_at\` text DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  )`,
];

/**
 * ALTER TABLE additions — wrapped in try/catch for idempotency.
 * SQLite errors on duplicate column names, so we silently ignore.
 *
 * IMPORTANT: only append to this list. Existing deployments rely on the
 * additive-only behavior; reordering or removing entries will not re-run them.
 */
const ALTER_STATEMENTS = [
  `ALTER TABLE \`domains\` ADD COLUMN \`cf_zone_id\` text`,
  `ALTER TABLE \`domains\` ADD COLUMN \`cf_setup_status\` text`,
  `ALTER TABLE \`domains\` ADD COLUMN \`resend_api_key\` text`,
  `ALTER TABLE \`domains\` ADD COLUMN \`resend_api_key_hint\` text`,
  // P0-6: password hashing algorithm collar
  `ALTER TABLE \`users\` ADD COLUMN \`password_algo\` text`,
  // P1-3: outbound delivery tracking via Resend webhook
  `ALTER TABLE \`messages\` ADD COLUMN \`delivery_status\` text`,
  `ALTER TABLE \`messages\` ADD COLUMN \`delivery_error\` text`,
  `ALTER TABLE \`messages\` ADD COLUMN \`delivery_updated_at\` text`,
];

/**
 * Fresh indexes added after the initial schema. Declarative + IF NOT EXISTS
 * so they are safe to run on every cold start.
 */
const POST_CREATE_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS \`messages_created_at_idx\` ON \`messages\` (\`created_at\`)`,
  `CREATE INDEX IF NOT EXISTS \`message_deliveries_mailbox_folder_idx\` ON \`message_deliveries\` (\`mailbox_id\`, \`folder\`)`,
];

/**
 * Run all CREATE TABLE IF NOT EXISTS statements, then apply ALTER TABLE additions.
 * Safe to call on every cold start — no-ops for existing tables/columns.
 */
export async function ensureTablesExist(db: D1Database): Promise<void> {
  for (const sql of MIGRATION_STATEMENTS) {
    await db.prepare(sql).run();
  }
  for (const sql of POST_CREATE_STATEMENTS) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Index already exists — ignore
    }
  }
  for (const sql of ALTER_STATEMENTS) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Column already exists — ignore
    }
  }
}
