import { sqliteTable, text, integer, real, uniqueIndex, primaryKey, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { leagues, teams, users } from "./schema";

// ============================================
// Cricket
//
// Cricket is a separate module with its own tables. Nothing here is shared with the FPL formats
// except the generic league plumbing it points at: `leagues`, `teams` (a team's identity only — its
// name and members) and `users`. See docs/11-cricket.md.
//
// Two layers:
//
//   Tournament data (cricket_tournaments … cricket_uploads) is uploaded once by the superadmin as
//   spreadsheets and shared by every league that plays that tournament. There is no cricket API;
//   these uploads are the only source of players, fixtures and points.
//
//   League data (cricket_league_config, cricket_team_state, the auction tables) belongs to one
//   league: its purse and squad rules, each team's purse, and what each team bought.
//
// No columns are added to `leagues` or `teams`: like FPL Classic, a side table degrades only this
// format if a migration lags behind a deploy.
//
// Money is in LAKHS everywhere (integers): 100 = ₹1 Cr. The UI formats it as ₹ Cr / L.
// ============================================

export const CRICKET_ROLES = ["WK", "BAT", "AR", "BOWL"] as const;
export type CricketRole = (typeof CRICKET_ROLES)[number];

export const CRICKET_MATCH_FORMATS = ["Test", "ODI", "T20"] as const;
export type CricketMatchFormat = (typeof CRICKET_MATCH_FORMATS)[number];

/** A tournament: one IPL season, or (later) a window combining several bilateral series. */
export const cricketTournaments = sqliteTable("cricket_tournaments", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(), // "IPL 2026"
  season: text("season").notNull(), // "2026"
  // "league" = one competition with franchises (IPL); "window" = several series over a month or
  // quarter. Only "league" tournaments can run a franchise auction.
  kind: text("kind", { enum: ["league", "window"] }).notNull().default("league"),
  status: text("status", { enum: ["draft", "ready", "archived"] }).notNull().default("draft"),
  // Bumped by every committed upload. Part of every cache key and of the upload preview's hash,
  // so a preview made before someone else's upload can't be committed over it.
  dataVersion: integer("data_version").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

/** Real teams: IPL franchises, or countries in a window. Uploaded via the Teams sheet. */
export const cricketTeams = sqliteTable("cricket_teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tournamentId: text("tournament_id").notNull().references(() => cricketTournaments.id, { onDelete: "cascade" }),
  code: text("code").notNull(), // "MI" — what the other sheets refer to
  name: text("name").notNull(), // "Mumbai Indians"
  // Opening price in the franchise auction, in lakhs. Unused for teams that are never auctioned.
  basePrice: integer("base_price").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  tournamentCodeUnique: uniqueIndex("cricket_teams_tournament_code_unique").on(table.tournamentId, table.code),
}));

/** Players, uploaded via the Players sheet. */
export const cricketPlayers = sqliteTable("cricket_players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tournamentId: text("tournament_id").notNull().references(() => cricketTournaments.id, { onDelete: "cascade" }),
  // The admin's own player_id. Keep it stable across uploads (and, later, across tournaments —
  // retention will match players by it).
  code: text("code").notNull(),
  name: text("name").notNull(),
  teamId: integer("team_id").notNull().references(() => cricketTeams.id),
  role: text("role", { enum: CRICKET_ROLES }).notNull(),
  basePrice: integer("base_price").notNull(), // lakhs
  overseas: integer("overseas", { mode: "boolean" }).notNull().default(false),
  // Matches this player is expected to play in the tournament, by format. Shown to managers so they
  // can value players; nothing is scored from them.
  matchesTest: integer("matches_test").notNull().default(0),
  matchesOdi: integer("matches_odi").notNull().default(0),
  matchesT20: integer("matches_t20").notNull().default(0),
  // Free-form JSON for later needs (retention, extra flags). Null until something uses it.
  extra: text("extra"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  tournamentCodeUnique: uniqueIndex("cricket_players_tournament_code_unique").on(table.tournamentId, table.code),
  tournamentTeamIdx: index("cricket_players_tournament_team").on(table.tournamentId, table.teamId),
}));

/**
 * Fixtures, uploaded via the Fixtures sheet. Fixture numbers restart at 1 in every series, so a
 * fixture is identified by (tournament, series, fixture number); `id` is the internal key the
 * points rows point at.
 */
export const cricketFixtures = sqliteTable("cricket_fixtures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tournamentId: text("tournament_id").notNull().references(() => cricketTournaments.id, { onDelete: "cascade" }),
  series: text("series").notNull(), // "IPL 2026", "IND vs AUS ODIs"
  fixtureNo: integer("fixture_no").notNull(), // 1, 2, 3 … within the series
  matchFormat: text("match_format", { enum: CRICKET_MATCH_FORMATS }).notNull(),
  teamAId: integer("team_a_id").notNull().references(() => cricketTeams.id),
  teamBId: integer("team_b_id").notNull().references(() => cricketTeams.id),
  // Stored in UTC; the sheet gives Indian time.
  startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
  venue: text("venue"),
  // "completed" once points are uploaded; "abandoned" is set by the superadmin and takes the
  // fixture out of the "every fixture scored" completion check.
  status: text("status", { enum: ["scheduled", "completed", "abandoned"] }).notNull().default("scheduled"),
  pointsUploadedAt: integer("points_uploaded_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  seriesNoUnique: uniqueIndex("cricket_fixtures_tournament_series_no_unique").on(table.tournamentId, table.series, table.fixtureNo),
  startsIdx: index("cricket_fixtures_tournament_starts").on(table.tournamentId, table.startsAt),
}));

/** One player's fantasy points in one fixture, uploaded via the Points sheet. */
export const cricketPlayerPoints = sqliteTable("cricket_player_points", {
  fixtureId: integer("fixture_id").notNull().references(() => cricketFixtures.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => cricketPlayers.id, { onDelete: "cascade" }),
  // Denormalised so a tournament's points load is one indexed scan.
  tournamentId: text("tournament_id").notNull().references(() => cricketTournaments.id, { onDelete: "cascade" }),
  points: real("points").notNull(),
  uploadId: text("upload_id"),
}, (table) => ({
  pk: primaryKey({ columns: [table.fixtureId, table.playerId] }),
  tournamentPlayerIdx: index("cricket_player_points_tournament_player").on(table.tournamentId, table.playerId),
}));

/** Audit trail: one row per committed upload. */
export const cricketUploads = sqliteTable("cricket_uploads", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id").notNull().references(() => cricketTournaments.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["teams", "players", "fixtures", "points"] }).notNull(),
  fileName: text("file_name"),
  rowCount: integer("row_count").notNull(),
  // JSON: { inserted, updated, deleted, unchanged, warnings, override }.
  summary: text("summary").notNull(),
  uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  tournamentIdx: index("cricket_uploads_tournament").on(table.tournamentId, table.createdAt),
}));

/**
 * One cricket league's settings. Created with the league.
 *
 * `squadRules` is JSON parsed by parseSquadRules (src/lib/cricket/squad-rules.ts):
 *   { minSize, maxSize, roleMin: {WK,BAT,AR,BOWL}, roleMax: {…}, maxPerRealTeam, maxOverseas }
 */
export const cricketLeagueConfig = sqliteTable("cricket_league_config", {
  leagueId: text("league_id").primaryKey().references(() => leagues.id, { onDelete: "cascade" }),
  // No cascade: a tournament that leagues are playing can't be deleted out from under them.
  tournamentId: text("tournament_id").notNull().references(() => cricketTournaments.id),
  purse: integer("purse").notNull(), // each team's starting purse, lakhs
  squadRules: text("squad_rules").notNull(),
  franchiseAuctionEnabled: integer("franchise_auction_enabled", { mode: "boolean" }).notNull().default(false),
  // Extra % on the points of players from the franchise a team owns (20 → ×1.2).
  franchiseBoostPercent: real("franchise_boost_percent").notNull().default(0),
  // What a team pays to clear one penalty slot during the player auction, lakhs.
  penaltyRedeemPrice: integer("penalty_redeem_price").notNull().default(0),
  // Default timers for new auction sessions.
  bidTimerSeconds: integer("bid_timer_seconds").notNull().default(20),
  nominationTimeoutSeconds: integer("nomination_timeout_seconds").notNull().default(60),
  // Set by the admin's "Mark complete"; the season is also complete once every fixture is scored.
  completedAt: integer("completed_at", { mode: "timestamp" }),
  // Bumped whenever squads, franchises or settings change. Part of the standings cache key.
  stateVersion: integer("state_version").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  tournamentIdx: index("cricket_league_config_tournament").on(table.tournamentId),
}));

/** A team's money and penalties in a cricket league. One row per team, created with the league. */
export const cricketTeamState = sqliteTable("cricket_team_state", {
  teamId: text("team_id").primaryKey().references(() => teams.id, { onDelete: "cascade" }),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  // What the team has left to spend, lakhs. The single source of truth: every purchase and
  // redemption decrements it in the same statement that checks it.
  purse: integer("purse").notNull(),
  spent: integer("spent").notNull().default(0),
  // Missed nominations in the player auction. Each one is a squad slot the team can't fill until
  // it is redeemed.
  penaltySlots: integer("penalty_slots").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  leagueIdx: index("cricket_team_state_league").on(table.leagueId),
}));

// ─── Auction ─────────────────────────────────────────────────────────────────
//
// The cricket auction engine (src/lib/cricket/auction/) runs on these tables. It follows the FPL
// auction's proven turn/lot mechanics but owns its own state, so neither format can disturb the
// other. Two session types: "franchise" (one IPL franchise per team, run first when the league has
// it switched on) and "player". There are no mini-auctions: squads are final once the player
// auction completes.

export const cricketAuctionSessions = sqliteTable("cricket_auction_sessions", {
  id: text("id").primaryKey(),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["franchise", "player"] }).notNull(),
  status: text("status", { enum: ["pending", "active", "paused", "completed"] }).notNull().default("pending"),
  // JSON array of team ids: the nomination ring, fixed when the session starts.
  ringOrder: text("ring_order").notNull().default("[]"),
  currentNominatorIndex: integer("current_nominator_index").notNull().default(0),
  // When the current nominator must nominate by; null while a lot is open or between turns.
  nominationDeadline: integer("nomination_deadline", { mode: "timestamp" }),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
  bidTimerSeconds: integer("bid_timer_seconds").notNull().default(20),
  nominationTimeoutSeconds: integer("nomination_timeout_seconds").notNull().default(60),
  intermissionSeconds: integer("intermission_seconds").notNull().default(5),
  // Post-sale pause before the next turn is armed; null when not in one.
  intermissionUntil: integer("intermission_until", { mode: "timestamp" }),
  // Set while paused; on resume every open deadline moves forward by the time spent paused.
  pausedAt: integer("paused_at", { mode: "timestamp" }),
  // Make-up turns owed to teams (JSON array of team ids, first in first out), served before the
  // ring; `ringReturnIndex` holds where the ring resumes. Same mechanics as the FPL auction.
  makeupQueue: text("makeup_queue").notNull().default("[]"),
  ringReturnIndex: integer("ring_return_index"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  leagueIdx: index("cricket_auction_sessions_league").on(table.leagueId, table.type),
}));

/** One thing up for sale: a player or a franchise. */
export const cricketAuctionLots = sqliteTable("cricket_auction_lots", {
  id: text("id").primaryKey(),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().references(() => cricketAuctionSessions.id, { onDelete: "cascade" }),
  lotKind: text("lot_kind", { enum: ["player", "franchise"] }).notNull(),
  // Exactly one of these is set, matching lotKind.
  playerId: integer("player_id").references(() => cricketPlayers.id),
  cricketTeamId: integer("cricket_team_id").references(() => cricketTeams.id),
  name: text("name").notNull(), // snapshot for the feed
  nominatorTeamId: text("nominator_team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  openingPrice: integer("opening_price").notNull(),
  currentHighBid: integer("current_high_bid").notNull(),
  currentHighBidderId: text("current_high_bidder_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["open", "sold", "cancelled"] }).notNull().default("open"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  sessionStatusIdx: index("cricket_auction_lots_session_status").on(table.sessionId, table.status),
  // At most one open lot per session, enforced by the database as well as by the engine.
  oneOpenLot: uniqueIndex("cricket_auction_lots_one_open").on(table.sessionId).where(sql`status = 'open'`),
}));

/** Append-only log of each lot: nomination, bids, sale or cancellation. */
export const cricketAuctionBidLogs = sqliteTable("cricket_auction_bid_logs", {
  id: text("id").primaryKey(),
  lotId: text("lot_id").notNull().references(() => cricketAuctionLots.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  type: text("type", { enum: ["nomination", "bid", "sold", "cancelled"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  lotIdx: index("cricket_auction_bid_logs_lot").on(table.lotId),
}));

/** Append-only audit of the nomination turn cycle (armed, nominated, penalised, …). */
export const cricketAuctionTurnEvents = sqliteTable("cricket_auction_turn_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => cricketAuctionSessions.id, { onDelete: "cascade" }),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  nominatorIndex: integer("nominator_index"),
  event: text("event").notNull(),
  actor: text("actor").notNull(), // "stream" | "rest" | "nominate" | "admin"
  detail: text("detail"), // optional JSON
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  sessionIdx: index("cricket_auction_turn_events_session").on(table.sessionId, table.createdAt),
}));

/** A team's priority list of players, used to nominate for them when their timer runs out. */
export const cricketWishlists = sqliteTable("cricket_wishlists", {
  id: text("id").primaryKey(),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: integer("player_id").notNull().references(() => cricketPlayers.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull(), // 1 = highest
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  teamPriority: index("cricket_wishlists_team_priority").on(table.teamId, table.priority),
  teamPlayerUnique: uniqueIndex("cricket_wishlists_team_player").on(table.teamId, table.playerId),
}));

/** The players each team bought. A player belongs to at most one team per league. */
export const cricketSquadPlayers = sqliteTable("cricket_squad_players", {
  id: text("id").primaryKey(),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  // No cascade: an owned player can't be deleted by a tournament upload.
  playerId: integer("player_id").notNull().references(() => cricketPlayers.id),
  price: integer("price").notNull(),
  sessionId: text("session_id").references(() => cricketAuctionSessions.id, { onDelete: "set null" }),
  lotId: text("lot_id"),
  acquiredAt: integer("acquired_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  leaguePlayerUnique: uniqueIndex("cricket_squad_players_league_player").on(table.leagueId, table.playerId),
  teamIdx: index("cricket_squad_players_team").on(table.teamId),
}));

/** The franchise each team bought: one per team, one owner per franchise. */
export const cricketFranchiseOwnership = sqliteTable("cricket_franchise_ownership", {
  id: text("id").primaryKey(),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  cricketTeamId: integer("cricket_team_id").notNull().references(() => cricketTeams.id),
  price: integer("price").notNull(),
  sessionId: text("session_id").references(() => cricketAuctionSessions.id, { onDelete: "set null" }),
  lotId: text("lot_id"),
  acquiredAt: integer("acquired_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  oneFranchisePerTeam: uniqueIndex("cricket_franchise_ownership_team").on(table.leagueId, table.teamId),
  oneOwnerPerFranchise: uniqueIndex("cricket_franchise_ownership_franchise").on(table.leagueId, table.cricketTeamId),
}));

/** Ledger of penalty slots from missed nominations, and their redemptions. */
export const cricketTeamPenalties = sqliteTable("cricket_team_penalties", {
  id: text("id").primaryKey(),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => cricketAuctionSessions.id, { onDelete: "set null" }),
  redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
  redemptionPrice: integer("redemption_price"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  teamIdx: index("cricket_team_penalties_team").on(table.teamId),
}));

export type CricketTournament = typeof cricketTournaments.$inferSelect;
export type CricketTeam = typeof cricketTeams.$inferSelect;
export type CricketPlayer = typeof cricketPlayers.$inferSelect;
export type CricketFixture = typeof cricketFixtures.$inferSelect;
export type CricketPlayerPoints = typeof cricketPlayerPoints.$inferSelect;
export type CricketUpload = typeof cricketUploads.$inferSelect;
export type CricketLeagueConfig = typeof cricketLeagueConfig.$inferSelect;
export type CricketTeamState = typeof cricketTeamState.$inferSelect;
export type CricketAuctionSession = typeof cricketAuctionSessions.$inferSelect;
export type CricketAuctionLot = typeof cricketAuctionLots.$inferSelect;
export type CricketSquadPlayer = typeof cricketSquadPlayers.$inferSelect;
export type CricketFranchiseOwnership = typeof cricketFranchiseOwnership.$inferSelect;
