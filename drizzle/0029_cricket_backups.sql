-- Stored snapshots of a cricket league's auction state, for the console's Backup tab.
-- Additive: apply with scripts/apply-0029-cricket-backups.mjs.
CREATE TABLE `cricket_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`trigger` text NOT NULL,
	`created_by` text,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cricket_backups_league` ON `cricket_backups` (`league_id`,`created_at`);
