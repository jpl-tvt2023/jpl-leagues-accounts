/**
 * Reading a cricket league: its settings, and the "league view" every cricket page renders from —
 * teams (named after their franchise once they own one), standings, the player pool with owners,
 * and fixtures. Built from the database and cached under the tournament's data version and the
 * league's state version (see cache.ts).
 */

import { and, eq, sql } from "drizzle-orm";
import {
  db,
  leagues,
  teams,
  cricketLeagueConfig,
  cricketTournaments,
  cricketTeams,
  cricketPlayers,
  cricketFixtures,
  cricketPlayerPoints,
  cricketTeamState,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  cricketAuctionSessions,
  type CricketRole,
} from "@/lib/db";
import { isCricketFormat } from "@/lib/sports/registry";
import { parseSquadRules, ROLES, type SquadRules } from "./squad-rules";
import { computeCricketStandings, type Standings } from "./scoring";
import { cacheGet, cacheSet, leagueViewKey } from "./cache";
import { playoffMatchesByTeam, playoffState, type PlayoffState } from "./match-counts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CricketLeagueInfo {
  league: { id: string; slug: string; name: string; season: string; teamSize: number };
  tournament: { id: string; name: string; kind: "league" | "window"; dataVersion: number };
  config: {
    purse: number;
    squadRules: SquadRules;
    franchiseAuctionEnabled: boolean;
    franchiseBoostPercent: number;
    penaltyRedeemPrice: number;
    bidTimerSeconds: number;
    nominationTimeoutSeconds: number;
    completedAt: string | null;
    stateVersion: number;
  };
}

/** A cricket league by slug or id, with its settings and tournament; null if not a cricket league. */
export async function loadCricketLeague(ref: string): Promise<CricketLeagueInfo | null> {
  const [row] = await db
    .select({
      id: leagues.id,
      slug: leagues.slug,
      name: leagues.name,
      season: leagues.season,
      format: leagues.format,
      teamSize: leagues.teamSize,
      config: cricketLeagueConfig,
      tournament: { id: cricketTournaments.id, name: cricketTournaments.name, kind: cricketTournaments.kind, dataVersion: cricketTournaments.dataVersion },
    })
    .from(leagues)
    .innerJoin(cricketLeagueConfig, eq(cricketLeagueConfig.leagueId, leagues.id))
    .innerJoin(cricketTournaments, eq(cricketTournaments.id, cricketLeagueConfig.tournamentId))
    .where(UUID_RE.test(ref) ? eq(leagues.id, ref) : eq(leagues.slug, ref))
    .limit(1);
  if (!row || !isCricketFormat(row.format)) return null;
  const c = row.config;
  return {
    league: { id: row.id, slug: row.slug, name: row.name, season: row.season, teamSize: row.teamSize },
    tournament: row.tournament,
    config: {
      purse: c.purse,
      squadRules: parseSquadRules(c.squadRules),
      franchiseAuctionEnabled: c.franchiseAuctionEnabled,
      franchiseBoostPercent: c.franchiseBoostPercent,
      penaltyRedeemPrice: c.penaltyRedeemPrice,
      bidTimerSeconds: c.bidTimerSeconds,
      nominationTimeoutSeconds: c.nominationTimeoutSeconds,
      completedAt: c.completedAt ? c.completedAt.toISOString() : null,
      stateVersion: c.stateVersion,
    },
  };
}

/** Statement that marks the league's squads/franchises/purses/settings as changed (new cache key). */
export function bumpStateVersion(leagueId: string) {
  return db
    .update(cricketLeagueConfig)
    .set({ stateVersion: sql`${cricketLeagueConfig.stateVersion} + 1`, updatedAt: new Date() })
    .where(eq(cricketLeagueConfig.leagueId, leagueId));
}

export interface ViewTeam {
  id: string;
  /** The manager's own team name. */
  ownName: string;
  /** What everyone sees: the franchise's name once the team owns one, else its own name. */
  name: string;
  franchise: { id: number; code: string; name: string; price: number } | null;
  purse: number;
  spent: number;
  penaltySlots: number;
  squadSize: number;
  roleCounts: Record<CricketRole, number>;
  overseasCount: number;
}

export interface ViewPlayer {
  id: number;
  code: string;
  name: string;
  teamId: number;
  role: CricketRole;
  basePrice: number;
  overseas: boolean;
  matchesTest: number;
  matchesOdi: number;
  matchesT20: number;
  /** Raw points across every uploaded fixture. */
  points: number;
  matches: number;
  ownerTeamId: string | null;
  price: number | null;
}

export interface ViewFixture {
  id: number;
  series: string;
  fixtureNo: number;
  stage: "group" | "playoff";
  matchFormat: "Test" | "ODI" | "T20";
  teamAId: number;
  teamBId: number;
  startsAt: string;
  venue: string | null;
  status: "scheduled" | "completed" | "abandoned";
  scored: boolean;
}

export interface LeagueView extends CricketLeagueInfo {
  /** `playoffMatches`: the team's playoff fixtures (0 until the playoffs are uploaded). */
  realTeams: Array<{ id: number; code: string; name: string; basePrice: number; ownerTeamId: string | null; playoffMatches: number }>;
  /** Whether this tournament has playoffs, and whether they are uploaded yet (see match-counts.ts). */
  playoffs: PlayoffState;
  teams: ViewTeam[];
  players: ViewPlayer[];
  fixtures: ViewFixture[];
  standings: Standings;
  /** Auction sessions, oldest first. Session status changes bump the state version, so this stays fresh. */
  auctionSessions: Array<{ id: string; type: "franchise" | "player"; status: "pending" | "active" | "paused" | "completed"; scheduledAt: string | null; completedAt: string | null }>;
  builtAt: string;
}

async function buildLeagueView(info: CricketLeagueInfo): Promise<LeagueView> {
  const leagueId = info.league.id;
  const tid = info.tournament.id;
  const [teamRows, realTeams, players, fixtures, points, squads, franchises, sessions] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name, purse: cricketTeamState.purse, spent: cricketTeamState.spent, penaltySlots: cricketTeamState.penaltySlots })
      .from(teams)
      .leftJoin(cricketTeamState, eq(cricketTeamState.teamId, teams.id))
      .where(and(eq(teams.leagueId, leagueId), eq(teams.isGhost, false))),
    db.select().from(cricketTeams).where(eq(cricketTeams.tournamentId, tid)),
    db.select().from(cricketPlayers).where(eq(cricketPlayers.tournamentId, tid)),
    db.select().from(cricketFixtures).where(eq(cricketFixtures.tournamentId, tid)),
    db
      .select({ fixtureId: cricketPlayerPoints.fixtureId, playerId: cricketPlayerPoints.playerId, points: cricketPlayerPoints.points })
      .from(cricketPlayerPoints)
      .where(eq(cricketPlayerPoints.tournamentId, tid)),
    db.select().from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, leagueId)),
    db.select().from(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, leagueId)),
    db.select().from(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, leagueId)),
  ]);

  const realTeamById = new Map(realTeams.map((t) => [t.id, t]));
  const playoffsByTeam = playoffMatchesByTeam(fixtures);
  const franchiseByTeam = new Map(franchises.map((f) => [f.teamId, f]));
  const ownerByRealTeam = new Map(franchises.map((f) => [f.cricketTeamId, f.teamId]));
  const squadByPlayer = new Map(squads.map((s) => [s.playerId, s]));
  const playerById = new Map(players.map((p) => [p.id, p]));

  const pointsByPlayer = new Map<number, { points: number; matches: number }>();
  for (const p of points) {
    const agg = pointsByPlayer.get(p.playerId) ?? { points: 0, matches: 0 };
    agg.points += p.points;
    agg.matches += 1;
    pointsByPlayer.set(p.playerId, agg);
  }

  const viewTeams: ViewTeam[] = teamRows.map((t) => {
    const f = franchiseByTeam.get(t.id);
    const real = f ? realTeamById.get(f.cricketTeamId) : undefined;
    const roleCounts = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<CricketRole, number>;
    let squadSize = 0;
    let overseasCount = 0;
    for (const s of squads) {
      if (s.teamId !== t.id) continue;
      const p = playerById.get(s.playerId);
      if (!p) continue;
      squadSize++;
      roleCounts[p.role]++;
      if (p.overseas) overseasCount++;
    }
    return {
      id: t.id,
      ownName: t.name,
      name: real ? real.name : t.name,
      franchise: real && f ? { id: real.id, code: real.code, name: real.name, price: f.price } : null,
      purse: t.purse ?? info.config.purse,
      spent: t.spent ?? 0,
      penaltySlots: t.penaltySlots ?? 0,
      squadSize,
      roleCounts,
      overseasCount,
    };
  });

  const standings = computeCricketStandings({
    teams: viewTeams.map((t) => ({ id: t.id, name: t.name, purse: t.purse })),
    squads: squads.map((s) => ({ teamId: s.teamId, playerId: s.playerId })),
    franchises: franchises.map((f) => ({ teamId: f.teamId, cricketTeamId: f.cricketTeamId })),
    players: players.map((p) => ({ id: p.id, teamId: p.teamId })),
    points,
    fixtures: fixtures.map((f) => ({ id: f.id, status: f.status, pointsUploadedAt: f.pointsUploadedAt })),
    boostPercent: info.config.franchiseAuctionEnabled ? info.config.franchiseBoostPercent : 0,
    completedAt: info.config.completedAt ? new Date(info.config.completedAt) : null,
  });

  return {
    ...info,
    realTeams: realTeams
      .map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        basePrice: t.basePrice,
        ownerTeamId: ownerByRealTeam.get(t.id) ?? null,
        playoffMatches: playoffsByTeam.get(t.id) ?? 0,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    playoffs: playoffState(info.tournament.kind, fixtures.filter((f) => f.stage === "playoff").length),
    teams: viewTeams,
    players: players
      .map((p) => {
        const s = squadByPlayer.get(p.id);
        const agg = pointsByPlayer.get(p.id);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          teamId: p.teamId,
          role: p.role,
          basePrice: p.basePrice,
          overseas: p.overseas,
          matchesTest: p.matchesTest,
          matchesOdi: p.matchesOdi,
          matchesT20: p.matchesT20,
          points: agg ? Math.round(agg.points * 100) / 100 : 0,
          matches: agg?.matches ?? 0,
          ownerTeamId: s?.teamId ?? null,
          price: s?.price ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    fixtures: fixtures
      .map((f) => ({
        id: f.id,
        series: f.series,
        fixtureNo: f.fixtureNo,
        stage: f.stage,
        matchFormat: f.matchFormat,
        teamAId: f.teamAId,
        teamBId: f.teamBId,
        startsAt: f.startsAt.toISOString(),
        venue: f.venue,
        status: f.status,
        scored: f.pointsUploadedAt !== null,
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.series.localeCompare(b.series) || a.fixtureNo - b.fixtureNo),
    standings,
    auctionSessions: sessions
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((s) => ({ id: s.id, type: s.type, status: s.status, scheduledAt: s.scheduledAt?.toISOString() ?? null, completedAt: s.completedAt?.toISOString() ?? null })),
    builtAt: new Date().toISOString(),
  };
}

/** The league view, from cache when its versions match. Null if `ref` isn't a cricket league. */
export async function getLeagueView(ref: string): Promise<LeagueView | null> {
  const info = await loadCricketLeague(ref);
  if (!info) return null;
  const key = leagueViewKey(info.league.id, info.tournament.dataVersion, info.config.stateVersion);
  const cached = await cacheGet<LeagueView>(key);
  if (cached) return cached;
  const view = await buildLeagueView(info);
  await cacheSet(key, view);
  return view;
}
