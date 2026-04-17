CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`permissions` text NOT NULL,
	`domain_id` text,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pending_2fa` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `domains` ADD `cf_zone_id` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `cf_setup_status` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `resend_api_key` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `resend_api_key_hint` text;--> statement-breakpoint
ALTER TABLE `domains` ADD `sender_provider` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `delivery_status` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `delivery_error` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `delivery_updated_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `messages_created_at_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `messages_deleted_at_idx` ON `messages` (`deleted_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `password_algo` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `backup_codes_enc` text;--> statement-breakpoint
CREATE INDEX `message_deliveries_mailbox_folder_idx` ON `message_deliveries` (`mailbox_id`,`folder`);