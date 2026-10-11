-- Saved FPL teams: a person may run several FPL teams and picks one of them for each league. One
-- of them is their primary, picked for them by default.
--
-- Additive: one new table, then every existing users.fpl_entry_id is copied into it (INSERT OR
-- IGNORE, so re-running is harmless). users.fpl_entry_id itself is left in place, no longer written.
--
-- Apply idempotently with scripts/apply-0026-user-fpl-teams.mjs.

CREATE TABLE `user_fpl_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`fpl_entry_id` text NOT NULL,
	`team_name` text,
	`manager_name` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_fpl_teams_user_entry_unique` ON `user_fpl_teams` (`user_id`,`fpl_entry_id`);
--> statement-breakpoint
CREATE INDEX `user_fpl_teams_user` ON `user_fpl_teams` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_fpl_teams_one_primary` ON `user_fpl_teams` (`user_id`) WHERE is_primary = 1;
--> statement-breakpoint
INSERT OR IGNORE INTO `user_fpl_teams` (`id`, `user_id`, `fpl_entry_id`, `team_name`, `manager_name`, `is_primary`, `created_at`)
SELECT lower(hex(randomblob(16))), `id`, `fpl_entry_id`, NULL, NULL, 1, CAST(strftime('%s', 'now') AS integer)
FROM `users`
WHERE `fpl_entry_id` IS NOT NULL AND `fpl_entry_id` != '';
