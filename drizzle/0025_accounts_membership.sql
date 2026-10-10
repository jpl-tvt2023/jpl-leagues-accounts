-- Accounts & membership: Google sign-in, usernames, and multi-league membership.
--
-- Purely additive: nullable or defaulted columns on existing tables, five new tables. No existing
-- row is read or rewritten, and no table is rebuilt — that is why users.password and
-- teams.password keep NOT NULL (members-mode rows store "") and users.role keeps its old default.
-- Every existing league becomes auth_mode = 'legacy' and behaves exactly as before.
--
-- Apply idempotently with scripts/apply-0025-accounts-membership.mjs.
-- Design: docs/10-accounts-and-membership.md.

ALTER TABLE `users` ADD `username` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_url` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `fpl_entry_id` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `session_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);
--> statement-breakpoint
ALTER TABLE `leagues` ADD `auth_mode` text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `user_id` text;
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `league_id` text;
--> statement-breakpoint
ALTER TABLE `feedback` ADD `submitter_user_id` text REFERENCES users(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `gameweek_captains` ADD `submitted_by_user_id` text REFERENCES users(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `gameweek_chips` ADD `submitted_by_user_id` text REFERENCES users(id) ON DELETE set null;
--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_provider_subject_unique` ON `user_identities` (`provider`,`provider_subject`);
--> statement-breakpoint
CREATE INDEX `user_identities_user` ON `user_identities` (`user_id`);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`league_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`player_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_team_user_unique` ON `team_members` (`team_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_league_user_unique` ON `team_members` (`league_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_team_owner_unique` ON `team_members` (`team_id`) WHERE role = 'owner';
--> statement-breakpoint
CREATE INDEX `team_members_user` ON `team_members` (`user_id`);
--> statement-breakpoint
CREATE TABLE `league_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text,
	`token` text NOT NULL,
	`created_by_user_id` text,
	`max_uses` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `league_invites_token_unique` ON `league_invites` (`token`);
--> statement-breakpoint
CREATE INDEX `league_invites_league` ON `league_invites` (`league_id`);
--> statement-breakpoint
CREATE TABLE `join_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`user_id` text NOT NULL,
	`invite_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_user_id` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invite_id`) REFERENCES `league_invites`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `join_requests_pending_unique` ON `join_requests` (`league_id`,`user_id`) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX `join_requests_league_status` ON `join_requests` (`league_id`,`status`);
--> statement-breakpoint
CREATE TABLE `auth_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`verifier_hash` text NOT NULL,
	`match_code` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
