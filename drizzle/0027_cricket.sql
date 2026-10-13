-- Cricket: the Classic Cricket Auction format (docs/11-cricket.md).
--
-- Additive: new cricket_* tables only. No existing table gains or loses a column; the tables are
-- defined in src/lib/db/schema-cricket.ts and kept separate from the FPL schema on purpose.
--
-- Apply idempotently with scripts/apply-0027-cricket.mjs.

CREATE TABLE `cricket_tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`season` text NOT NULL,
	`kind` text DEFAULT 'league' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`data_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_tournaments_slug_unique` ON `cricket_tournaments` (`slug`);
--> statement-breakpoint
CREATE TABLE `cricket_teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tournament_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`base_price` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `cricket_tournaments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_teams_tournament_code_unique` ON `cricket_teams` (`tournament_id`,`code`);
--> statement-breakpoint
CREATE TABLE `cricket_players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tournament_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`team_id` integer NOT NULL,
	`role` text NOT NULL,
	`base_price` integer NOT NULL,
	`overseas` integer DEFAULT false NOT NULL,
	`matches_test` integer DEFAULT 0 NOT NULL,
	`matches_odi` integer DEFAULT 0 NOT NULL,
	`matches_t20` integer DEFAULT 0 NOT NULL,
	`extra` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `cricket_tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `cricket_teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_players_tournament_code_unique` ON `cricket_players` (`tournament_id`,`code`);
--> statement-breakpoint
CREATE INDEX `cricket_players_tournament_team` ON `cricket_players` (`tournament_id`,`team_id`);
--> statement-breakpoint
CREATE TABLE `cricket_fixtures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tournament_id` text NOT NULL,
	`series` text NOT NULL,
	`fixture_no` integer NOT NULL,
	`match_format` text NOT NULL,
	`team_a_id` integer NOT NULL,
	`team_b_id` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`venue` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`points_uploaded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `cricket_tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_a_id`) REFERENCES `cricket_teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_b_id`) REFERENCES `cricket_teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_fixtures_tournament_series_no_unique` ON `cricket_fixtures` (`tournament_id`,`series`,`fixture_no`);
--> statement-breakpoint
CREATE INDEX `cricket_fixtures_tournament_starts` ON `cricket_fixtures` (`tournament_id`,`starts_at`);
--> statement-breakpoint
CREATE TABLE `cricket_player_points` (
	`fixture_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`tournament_id` text NOT NULL,
	`points` real NOT NULL,
	`upload_id` text,
	PRIMARY KEY(`fixture_id`, `player_id`),
	FOREIGN KEY (`fixture_id`) REFERENCES `cricket_fixtures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `cricket_players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tournament_id`) REFERENCES `cricket_tournaments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cricket_player_points_tournament_player` ON `cricket_player_points` (`tournament_id`,`player_id`);
--> statement-breakpoint
CREATE TABLE `cricket_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text,
	`row_count` integer NOT NULL,
	`summary` text NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `cricket_tournaments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cricket_uploads_tournament` ON `cricket_uploads` (`tournament_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `cricket_league_config` (
	`league_id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`purse` integer NOT NULL,
	`squad_rules` text NOT NULL,
	`franchise_auction_enabled` integer DEFAULT false NOT NULL,
	`franchise_boost_percent` real DEFAULT 0 NOT NULL,
	`penalty_redeem_price` integer DEFAULT 0 NOT NULL,
	`bid_timer_seconds` integer DEFAULT 20 NOT NULL,
	`nomination_timeout_seconds` integer DEFAULT 60 NOT NULL,
	`completed_at` integer,
	`state_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tournament_id`) REFERENCES `cricket_tournaments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cricket_league_config_tournament` ON `cricket_league_config` (`tournament_id`);
--> statement-breakpoint
CREATE TABLE `cricket_team_state` (
	`team_id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`purse` integer NOT NULL,
	`spent` integer DEFAULT 0 NOT NULL,
	`penalty_slots` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cricket_team_state_league` ON `cricket_team_state` (`league_id`);
--> statement-breakpoint
CREATE TABLE `cricket_auction_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ring_order` text DEFAULT '[]' NOT NULL,
	`current_nominator_index` integer DEFAULT 0 NOT NULL,
	`nomination_deadline` integer,
	`scheduled_at` integer,
	`bid_timer_seconds` integer DEFAULT 20 NOT NULL,
	`nomination_timeout_seconds` integer DEFAULT 60 NOT NULL,
	`intermission_seconds` integer DEFAULT 5 NOT NULL,
	`intermission_until` integer,
	`paused_at` integer,
	`makeup_queue` text DEFAULT '[]' NOT NULL,
	`ring_return_index` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cricket_auction_sessions_league` ON `cricket_auction_sessions` (`league_id`,`type`);
--> statement-breakpoint
CREATE TABLE `cricket_auction_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`session_id` text NOT NULL,
	`lot_kind` text NOT NULL,
	`player_id` integer,
	`cricket_team_id` integer,
	`name` text NOT NULL,
	`nominator_team_id` text NOT NULL,
	`opening_price` integer NOT NULL,
	`current_high_bid` integer NOT NULL,
	`current_high_bidder_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `cricket_auction_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `cricket_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cricket_team_id`) REFERENCES `cricket_teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nominator_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_high_bidder_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_auction_lots_one_open` ON `cricket_auction_lots` (`session_id`) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX `cricket_auction_lots_session_status` ON `cricket_auction_lots` (`session_id`,`status`);
--> statement-breakpoint
CREATE TABLE `cricket_auction_bid_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`team_id` text NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `cricket_auction_lots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cricket_auction_bid_logs_lot` ON `cricket_auction_bid_logs` (`lot_id`);
--> statement-breakpoint
CREATE TABLE `cricket_auction_turn_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text,
	`nominator_index` integer,
	`event` text NOT NULL,
	`actor` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cricket_auction_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cricket_auction_turn_events_session` ON `cricket_auction_turn_events` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `cricket_wishlists` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` integer NOT NULL,
	`priority` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `cricket_players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_wishlists_team_player` ON `cricket_wishlists` (`team_id`,`player_id`);
--> statement-breakpoint
CREATE INDEX `cricket_wishlists_team_priority` ON `cricket_wishlists` (`team_id`,`priority`);
--> statement-breakpoint
CREATE TABLE `cricket_squad_players` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text NOT NULL,
	`player_id` integer NOT NULL,
	`price` integer NOT NULL,
	`session_id` text,
	`lot_id` text,
	`acquired_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `cricket_players`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `cricket_auction_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_squad_players_league_player` ON `cricket_squad_players` (`league_id`,`player_id`);
--> statement-breakpoint
CREATE INDEX `cricket_squad_players_team` ON `cricket_squad_players` (`team_id`);
--> statement-breakpoint
CREATE TABLE `cricket_franchise_ownership` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text NOT NULL,
	`cricket_team_id` integer NOT NULL,
	`price` integer NOT NULL,
	`session_id` text,
	`lot_id` text,
	`acquired_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cricket_team_id`) REFERENCES `cricket_teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `cricket_auction_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_franchise_ownership_franchise` ON `cricket_franchise_ownership` (`league_id`,`cricket_team_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `cricket_franchise_ownership_team` ON `cricket_franchise_ownership` (`league_id`,`team_id`);
--> statement-breakpoint
CREATE TABLE `cricket_team_penalties` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text NOT NULL,
	`session_id` text,
	`redeemed_at` integer,
	`redemption_price` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `cricket_auction_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cricket_team_penalties_team` ON `cricket_team_penalties` (`team_id`);
