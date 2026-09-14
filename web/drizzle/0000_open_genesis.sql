CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`status` integer NOT NULL,
	`doc_type` text,
	`verdict` text,
	`sefach` integer DEFAULT false NOT NULL,
	`mode` text NOT NULL,
	`source` text NOT NULL,
	`api_key_id` text,
	`backend` text,
	`model` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`tokens_cached` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`result_enc` text
);
--> statement-breakpoint
CREATE INDEX `documents_user_created` ON `documents` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `documents_user_mode_status` ON `documents` (`user_id`,`mode`,`status`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`store_results` integer DEFAULT false NOT NULL,
	`anthropic_key_enc` text,
	`anthropic_key_last4` text,
	`model` text,
	`backend` text,
	`updated_at` text NOT NULL
);
