CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`trial_unlimited` integer DEFAULT false NOT NULL,
	`email` text,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
