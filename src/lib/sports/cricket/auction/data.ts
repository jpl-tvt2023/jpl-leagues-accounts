/**
 * What the cricket auction engine needs to decide anything: the player pool and franchises (cached
 * per tournament data version), and the league's live state — who owns what, purses, penalties.
 * Plus the eligibility questions built on it: can this team nominate, may it add this player, what
 * is the most it may bid.
 */

import { eq } from "drizzle-orm";
import {
  db,
  cricketPlayers,
  cricketTeams,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  cricketTeamState,
  teams,
  type CricketRole,
} from "@/lib/db";
import { loadCricketLeague, type CricketLeagueInfo } from "../league";
import {
  canAddPlayer,
  franchiseOpeningPrice,
  maxAffordableBid,
  squadCap,
  squadStateOf,
  type PlayerTraits,
  type SquadState,
} from "./rules";

export interface PoolPlayer extends PlayerTraits {
  id: number;
  name: string;
  basePrice: number;
}

export interface PoolTeam {
  id: number;
  code: string;
  name: string;
  basePrice: number;
}

interface Pool {
  players: Map<number, PoolPlayer>;
  realTeams: Map<number, PoolTeam>;
}

// The pool only changes with an upload (which bumps dataVersion), and the auction reads it on every
// eligibility check, so keep it in memory per process for a minute.
const POOL_TTL_MS = 60_000;
const poolCache = new Map<string, { at: number; pool: Pool }>();

async function loadPool(tournamentId: string, dataVersion: number): Promise<Pool> {
  const key = `${tournamentId}:${dataVersion}`;
  const hit = poolCache.get(key);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.pool;
  const [players, realTeams] = await Promise.all([
    db
      .select({
        id: cricketPlayers.id,
        name: cricketPlayers.name,
        role: cricketPlayers.role,
        teamId: cricketPlayers.teamId,
        overseas: cricketPlayers.overseas,
        basePrice: cricketPlayers.basePrice,
      })
      .from(cricketPlayers)
      .where(eq(cricketPlayers.tournamentId, tournamentId)),
    db.select({ id: cricketTeams.id, code: cricketTeams.code, name: cricketTeams.name, basePrice: cricketTeams.basePrice }).from(cricketTeams).where(eq(cricketTeams.tournamentId, tournamentId)),
  ]);
  const pool: Pool = {
    players: new Map(players.map((p) => [p.id, { ...p, role: p.role as CricketRole }])),
    realTeams: new Map(realTeams.map((t) => [t.id, t])),
  };
  poolCache.set(key, { at: Date.now(), pool });
  return pool;
}

export interface TeamAuctionState {
  id: string;
  name: string;
  purse: number;
  spent: number;
  penaltySlots: number;
  squad: SquadState;
  franchiseId: number | null;
}

export interface AuctionData {
  info: CricketLeagueInfo;
  pool: Pool;
  teams: Map<string, TeamAuctionState>;
  /** playerId → owning team id. */
  playerOwner: Map<number, string>;
  /** cricket team id → owning team id. */
  franchiseOwner: Map<number, string>;
  /** Prices paid for franchises so far (the rising floor's input). */
  franchisePrices: number[];
}

export async function loadAuctionData(leagueId: string): Promise<AuctionData | null> {
  const info = await loadCricketLeague(leagueId);
  if (!info) return null;
  const lid = info.league.id;
  const [pool, teamRows, squads, franchises] = await Promise.all([
    loadPool(info.tournament.id, info.tournament.dataVersion),
    db
      .select({ id: teams.id, name: teams.name, purse: cricketTeamState.purse, spent: cricketTeamState.spent, penaltySlots: cricketTeamState.penaltySlots })
      .from(teams)
      .innerJoin(cricketTeamState, eq(cricketTeamState.teamId, teams.id))
      .where(eq(teams.leagueId, lid)),
    db.select({ teamId: cricketSquadPlayers.teamId, playerId: cricketSquadPlayers.playerId }).from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, lid)),
    db
      .select({ teamId: cricketFranchiseOwnership.teamId, cricketTeamId: cricketFranchiseOwnership.cricketTeamId, price: cricketFranchiseOwnership.price })
      .from(cricketFranchiseOwnership)
      .where(eq(cricketFranchiseOwnership.leagueId, lid)),
  ]);
  const squadTraits = new Map<string, PlayerTraits[]>();
  const playerOwner = new Map<number, string>();
  for (const s of squads) {
    playerOwner.set(s.playerId, s.teamId);
    const p = pool.players.get(s.playerId);
    if (!p) continue;
    const list = squadTraits.get(s.teamId) ?? [];
    list.push(p);
    squadTraits.set(s.teamId, list);
  }
  const franchiseByTeam = new Map(franchises.map((f) => [f.teamId, f.cricketTeamId]));
  return {
    info,
    pool,
    teams: new Map(
      teamRows.map((t) => [
        t.id,
        {
          id: t.id,
          name: t.name,
          purse: t.purse,
          spent: t.spent,
          penaltySlots: t.penaltySlots,
          squad: squadStateOf(squadTraits.get(t.id) ?? []),
          franchiseId: franchiseByTeam.get(t.id) ?? null,
        },
      ]),
    ),
    playerOwner,
    franchiseOwner: new Map(franchises.map((f) => [f.cricketTeamId, f.teamId])),
    franchisePrices: franchises.map((f) => f.price),
  };
}

/** Cheapest base price among players nobody owns (optionally ignoring one); 0 if none are left. */
export function cheapestUnsoldBase(data: AuctionData, excludePlayerId?: number): number {
  let min = Infinity;
  for (const p of data.pool.players.values()) {
    if (p.id === excludePlayerId || data.playerOwner.has(p.id)) continue;
    if (p.basePrice < min) min = p.basePrice;
  }
  return Number.isFinite(min) ? min : 0;
}

export function franchiseOpening(data: AuctionData, cricketTeamId: number): number {
  const t = data.pool.realTeams.get(cricketTeamId);
  return franchiseOpeningPrice(t?.basePrice ?? 0, data.franchisePrices);
}

/** The most `teamId` may bid on a player (or, with no player, a franchise). */
export function maxBidFor(data: AuctionData, teamId: string, kind: "player" | "franchise", playerId?: number): number {
  const team = data.teams.get(teamId);
  if (!team) return 0;
  return maxAffordableBid({
    purse: team.purse,
    squad: team.squad,
    rules: data.info.config.squadRules,
    cheapestBasePrice: cheapestUnsoldBase(data, playerId),
    addsPlayer: kind === "player",
  });
}

/** Whether `teamId` may buy `playerId` at `price` (ownership, squad rules, reserve rule). */
export function checkPlayerPurchase(data: AuctionData, teamId: string, playerId: number, price: number): { ok: true } | { ok: false; error: string } {
  const team = data.teams.get(teamId);
  const player = data.pool.players.get(playerId);
  if (!team) return { ok: false, error: "Team not in this league" };
  if (!player) return { ok: false, error: "No such player in this tournament" };
  if (data.playerOwner.has(playerId)) return { ok: false, error: `${player.name} is already sold` };
  const fit = canAddPlayer(team.squad, data.info.config.squadRules, team.penaltySlots, player);
  if (!fit.ok) return fit;
  const max = maxBidFor(data, teamId, "player", playerId);
  if (price > max) return { ok: false, error: max < player.basePrice ? "You can't afford this player and still complete your squad" : `The most you can bid is ${max} L (you must keep enough to complete your squad)` };
  return { ok: true };
}

/** Whether `teamId` may buy franchise `cricketTeamId` at `price`. */
export function checkFranchisePurchase(data: AuctionData, teamId: string, cricketTeamId: number, price: number): { ok: true } | { ok: false; error: string } {
  const team = data.teams.get(teamId);
  const real = data.pool.realTeams.get(cricketTeamId);
  if (!team) return { ok: false, error: "Team not in this league" };
  if (!real) return { ok: false, error: "No such franchise in this tournament" };
  if (team.franchiseId !== null) return { ok: false, error: "You already own a franchise" };
  if (data.franchiseOwner.has(cricketTeamId)) return { ok: false, error: `${real.name} is already sold` };
  const max = maxBidFor(data, teamId, "franchise");
  if (price > max) return { ok: false, error: "You can't afford that and still complete your squad" };
  return { ok: true };
}

/** Unsold franchises `teamId` could open the bidding on right now. */
export function affordableFranchises(data: AuctionData, teamId: string): PoolTeam[] {
  const team = data.teams.get(teamId);
  if (!team || team.franchiseId !== null) return [];
  const max = maxBidFor(data, teamId, "franchise");
  return [...data.pool.realTeams.values()].filter((t) => !data.franchiseOwner.has(t.id) && franchiseOpening(data, t.id) <= max);
}

/** Whether `teamId` has anything it could nominate in a session of `type`. */
export function canNominateAnything(data: AuctionData, type: "franchise" | "player", teamId: string): boolean {
  const team = data.teams.get(teamId);
  if (!team) return false;
  if (type === "franchise") return affordableFranchises(data, teamId).length > 0;
  if (team.squad.size >= squadCap(data.info.config.squadRules, team.penaltySlots)) return false;
  for (const p of data.pool.players.values()) {
    if (!data.playerOwner.has(p.id) && checkPlayerPurchase(data, teamId, p.id, p.basePrice).ok) return true;
  }
  return false;
}
