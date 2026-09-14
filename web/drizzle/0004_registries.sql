ALTER TABLE `documents` ADD `registries` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `check_registries` integer DEFAULT false NOT NULL;