/**
 * Cricket tournaments: the shared data (teams, players, fixtures, points) that leagues play on.
 * Superadmin-only; see src/app/api/superadmin/cricket/.
 */

import { and, asc, count, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import {
  db,
  cricketTournaments,
  cricketTeams,
  cricketPlayers,
  cricketFixtures,
  cricketPlayerPoints,
  cricketUploads,
  cricketLeagueConfig,
  cricketAuctionSessions,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  leagues,
  type CricketTournament,
} from "@/lib/db";
import { generateId } from "@/lib/id";

export const TOURNAMENT_KINDS = ["league", "window"] as const;

export function slugifyTournament(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface TournamentSummary extends CricketTournament {
  teams: number;
  players: number;
  fixtures: number;
  fixturesScored: number;
  leagues: Array<{ id: string; slug: string; name: string }>;
}

export async function listTournaments(): Promise<TournamentSummary[]> {
  const rows = await db.select().from(cricketTournaments).orderBy(asc(cricketTournaments.createdAt));
  return Promise.all(rows.map((t) => summarise(t)));
}

export async function getTournament(id: string): Promise<CricketTournament | null> {
  const [row] = await db.select().from(cricketTournaments).where(eq(cricketTournaments.id, id)).limit(1);
  return row ?? null;
}

export async function getTournamentSummary(id: string): Promise<TournamentSummary | null> {
  const t = await getTournament(id);
  return t ? summarise(t) : null;
}

async function summarise(t: CricketTournament): Promise<TournamentSummary> {
  const [[teams], [players], [fixtures], [scored], linked] = await Promise.all([
    db.select({ n: count() }).from(cricketTeams).where(eq(cricketTeams.tournamentId, t.id)),
    db.select({ n: count() }).from(cricketPlayers).where(eq(cricketPlayers.tournamentId, t.id)),
    db.select({ n: count() }).from(cricketFixtures).where(eq(cricketFixtures.tournamentId, t.id)),
    db.select({ n: count() }).from(cricketFixtures).where(and(eq(cricketFixtures.tournamentId, t.id), isNotNull(cricketFixtures.pointsUploadedAt))),
    linkedLeagues(t.id),
  ]);
  return { ...t, teams: teams.n, players: players.n, fixtures: fixtures.n, fixturesScored: scored.n, leagues: linked };
}

export async function linkedLeagues(tournamentId: string): Promise<Array<{ id: string; slug: string; name: string }>> {
  return db
    .select({ id: leagues.id, slug: leagues.slug, name: leagues.name })
    .from(cricketLeagueConfig)
    .innerJoin(leagues, eq(leagues.id, cricketLeagueConfig.leagueId))
    .where(eq(cricketLeagueConfig.tournamentId, tournamentId));
}

export class TournamentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function createTournament(input: { name: string; season: string; kind: string; slug?: string }): Promise<CricketTournament> {
  const name = input.name.trim();
  const season = input.season.trim();
  if (!name) throw new TournamentError("Name is required", 400);
  if (!season) throw new TournamentError("Season is required", 400);
  if (!(TOURNAMENT_KINDS as readonly string[]).includes(input.kind)) throw new TournamentError("Kind must be league or window", 400);
  const slug = slugifyTournament(input.slug?.trim() || name);
  if (!slug) throw new TournamentError("Name needs some letters or digits", 400);
  const [clash] = await db.select({ id: cricketTournaments.id }).from(cricketTournaments).where(eq(cricketTournaments.slug, slug)).limit(1);
  if (clash) throw new TournamentError(`A tournament called "${slug}" already exists`, 409);
  const [row] = await db
    .insert(cricketTournaments)
    .values({ id: generateId(), slug, name, season, kind: input.kind as (typeof TOURNAMENT_KINDS)[number] })
    .returning();
  return row;
}

export async function updateTournament(
  id: string,
  patch: { name?: string; season?: string; status?: string },
): Promise<CricketTournament> {
  const set: Partial<typeof cricketTournaments.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new TournamentError("Name is required", 400);
    set.name = patch.name.trim();
  }
  if (patch.season !== undefined) {
    if (!patch.season.trim()) throw new TournamentError("Season is required", 400);
    set.season = patch.season.trim();
  }
  if (patch.status !== undefined) {
    if (!["draft", "ready", "archived"].includes(patch.status)) throw new TournamentError("Status must be draft, ready or archived", 400);
    set.status = patch.status as "draft" | "ready" | "archived";
  }
  const [row] = await db.update(cricketTournaments).set(set).where(eq(cricketTournaments.id, id)).returning();
  if (!row) throw new TournamentError("Tournament not found", 404);
  return row;
}

/** Deletes a tournament and all its data. Refused while any league plays it. */
export async function deleteTournament(id: string): Promise<void> {
  const linked = await linkedLeagues(id);
  if (linked.length) {
    throw new TournamentError(`Leagues still play this tournament: ${linked.map((l) => l.name).join(", ")}`, 409);
  }
  // Points and fixtures go before players and teams: their foreign keys don't cascade from teams.
  await db.batch([
    db.delete(cricketPlayerPoints).where(eq(cricketPlayerPoints.tournamentId, id)),
    db.delete(cricketFixtures).where(eq(cricketFixtures.tournamentId, id)),
    db.delete(cricketPlayers).where(eq(cricketPlayers.tournamentId, id)),
    db.delete(cricketTeams).where(eq(cricketTeams.tournamentId, id)),
    db.delete(cricketUploads).where(eq(cricketUploads.tournamentId, id)),
    db.delete(cricketTournaments).where(eq(cricketTournaments.id, id)),
  ]);
}

/** How leagues are using a tournament: what uploads must not break. */
export interface TournamentUsage {
  /** Any linked league has started (or finished) any auction session. */
  auctionStarted: boolean;
  franchiseAuctionStarted: boolean;
  ownedPlayerIds: Set<number>;
  ownedFranchiseTeamIds: Set<number>;
  /** Linked leagues already marked complete (points changes still recalculate them). */
  completedLeagueNames: string[];
}

export async function loadTournamentUsage(tournamentId: string): Promise<TournamentUsage> {
  const leagueIds = (await db.select({ id: cricketLeagueConfig.leagueId }).from(cricketLeagueConfig).where(eq(cricketLeagueConfig.tournamentId, tournamentId))).map((r) => r.id);
  if (leagueIds.length === 0) {
    return { auctionStarted: false, franchiseAuctionStarted: false, ownedPlayerIds: new Set(), ownedFranchiseTeamIds: new Set(), completedLeagueNames: [] };
  }
  const [sessions, owned, franchises, completed] = await Promise.all([
    db
      .select({ type: cricketAuctionSessions.type })
      .from(cricketAuctionSessions)
      .where(and(inArray(cricketAuctionSessions.leagueId, leagueIds), ne(cricketAuctionSessions.status, "pending"))),
    db.select({ playerId: cricketSquadPlayers.playerId }).from(cricketSquadPlayers).where(inArray(cricketSquadPlayers.leagueId, leagueIds)),
    db.select({ teamId: cricketFranchiseOwnership.cricketTeamId }).from(cricketFranchiseOwnership).where(inArray(cricketFranchiseOwnership.leagueId, leagueIds)),
    db
      .select({ name: leagues.name })
      .from(cricketLeagueConfig)
      .innerJoin(leagues, eq(leagues.id, cricketLeagueConfig.leagueId))
      .where(and(eq(cricketLeagueConfig.tournamentId, tournamentId), isNotNull(cricketLeagueConfig.completedAt))),
  ]);
  return {
    auctionStarted: sessions.length > 0,
    franchiseAuctionStarted: sessions.some((s) => s.type === "franchise"),
    ownedPlayerIds: new Set(owned.map((o) => o.playerId)),
    ownedFranchiseTeamIds: new Set(franchises.map((f) => f.teamId)),
    completedLeagueNames: completed.map((c) => c.name),
  };
}

/** Every player who has at least one points row. */
export async function playersWithPoints(tournamentId: string): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ playerId: cricketPlayerPoints.playerId })
    .from(cricketPlayerPoints)
    .where(eq(cricketPlayerPoints.tournamentId, tournamentId));
  return new Set(rows.map((r) => r.playerId));
}

/** Fixture ids that have at least one points row. */
export async function fixturesWithPoints(tournamentId: string): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ fixtureId: cricketPlayerPoints.fixtureId })
    .from(cricketPlayerPoints)
    .where(eq(cricketPlayerPoints.tournamentId, tournamentId));
  return new Set(rows.map((r) => r.fixtureId));
}

/** Mark a fixture abandoned (or back to scheduled/completed), or clear its points. */
export async function updateFixtureStatus(
  tournamentId: string,
  fixtureId: number,
  action: "abandon" | "reinstate" | "clear-points",
): Promise<void> {
  const [fixture] = await db
    .select({ id: cricketFixtures.id })
    .from(cricketFixtures)
    .where(and(eq(cricketFixtures.id, fixtureId), eq(cricketFixtures.tournamentId, tournamentId)))
    .limit(1);
  if (!fixture) throw new TournamentError("Fixture not found", 404);
  const now = new Date();
  const bump = db
    .update(cricketTournaments)
    .set({ dataVersion: sql`${cricketTournaments.dataVersion} + 1`, updatedAt: now })
    .where(eq(cricketTournaments.id, tournamentId));
  if (action === "clear-points") {
    await db.batch([
      db.delete(cricketPlayerPoints).where(eq(cricketPlayerPoints.fixtureId, fixtureId)),
      db.update(cricketFixtures).set({ status: "scheduled", pointsUploadedAt: null, updatedAt: now }).where(eq(cricketFixtures.id, fixtureId)),
      bump,
    ]);
    return;
  }
  if (action === "abandon") {
    await db.batch([db.update(cricketFixtures).set({ status: "abandoned", updatedAt: now }).where(eq(cricketFixtures.id, fixtureId)), bump]);
    return;
  }
  // Reinstate: back to completed if it has points, else scheduled.
  const [hasPoints] = await db.select({ n: count() }).from(cricketPlayerPoints).where(eq(cricketPlayerPoints.fixtureId, fixtureId));
  await db.batch([
    db
      .update(cricketFixtures)
      .set({ status: hasPoints.n > 0 ? "completed" : "scheduled", updatedAt: now })
      .where(eq(cricketFixtures.id, fixtureId)),
    bump,
  ]);
}
