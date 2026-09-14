CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_invitation_id` text NOT NULL,
	`email` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`accepted_user_id` text,
	`accepted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_one_pending` ON `invitations` (`email`) WHERE status = 'pending';