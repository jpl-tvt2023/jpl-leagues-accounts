/**
 * League-admin changes to a cricket league: its settings, the season's completion and team names,
 * plus the console's team and money views.
 *
 * Settings that shape the auction or the scoring (purse, squad rules, franchise auction and boost,
 * redeem price) are locked once any auction session exists — changing them mid-auction would be
 * unfair to whoever already bought. The timers only affect sessions not yet created, so they can
 * always change.
 */

import { and, count, eq, ne, sql } from "drizzle-orm";
import {
  db,
  teams,
  teamMembers,
  users,
  cricketLeagueConfig,
  cricketTeamState,
  cricketAuctionSessions,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  cricketTeams,
  cricketTeamPenalties,
} from "@/lib/db";
import { bumpStateVersion, loadCricketLeague, type CricketLeagueInfo } from "./league";
import { validateCricketSettings, type CricketLeagueSettings } from "./league-settings";

export class CricketAdminError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function requireCricketLeague(leagueId: string): Promise<CricketLeagueInfo> {
  const info = await loadCricketLeague(leagueId);
  if (!info) throw new CricketAdminError("Not a cricket league", 404);
  return info;
}

export async function auctionSessionCount(leagueId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, leagueId));
  return row.n;
}

/** The league's settings as the console edits them. */
export function settingsOf(info: CricketLeagueInfo): CricketLeagueSettings {
  return {
    tournamentId: info.tournament.id,
    purse: info.config.purse,
    squadRules: info.config.squadRules,
    franchiseAuctionEnabled: info.config.franchiseAuctionEnabled,
    franchiseBoostPercent: info.config.franchiseBoostPercent,
    penaltyRedeemPrice: info.config.penaltyRedeemPrice,
    bidTimerSeconds: info.config.bidTimerSeconds,
    nominationTimeoutSeconds: info.config.nominationTimeoutSeconds,
  };
}

export async function updateCricketSettings(leagueId: string, input: unknown): Promise<CricketLeagueInfo> {
  const info = await requireCricketLeague(leagueId);
  // The tournament can't change: squads, prices and franchises all refer to its players and teams.
  const body = { ...(input as Record<string, unknown>), tournamentId: info.tournament.id };
  const check = validateCricketSettings(body, { tournamentKind: info.tournament.kind });
  if (!check.ok) throw new CricketAdminError(check.error, 400);
  const next = check.value;
  const current = settingsOf(info);
  const now = new Date();

  const locked = (await auctionSessionCount(info.league.id)) > 0;
  const changedLocked =
    next.purse !== current.purse ||
    JSON.stringify(next.squadRules) !== JSON.stringify(current.squadRules) ||
    next.franchiseAuctionEnabled !== current.franchiseAuctionEnabled ||
    next.franchiseBoostPercent !== current.franchiseBoostPercent ||
    next.penaltyRedeemPrice !== current.penaltyRedeemPrice;
  if (locked && changedLocked) {
    throw new CricketAdminError("The auction has started: only the timers can change now", 409);
  }

  await db.batch([
    db
      .update(cricketLeagueConfig)
      .set({
        purse: next.purse,
        squadRules: JSON.stringify(next.squadRules),
        franchiseAuctionEnabled: next.franchiseAuctionEnabled,
        franchiseBoostPercent: next.franchiseBoostPercent,
        penaltyRedeemPrice: next.penaltyRedeemPrice,
        bidTimerSeconds: next.bidTimerSeconds,
        nominationTimeoutSeconds: next.nominationTimeoutSeconds,
        updatedAt: now,
      })
      .where(eq(cricketLeagueConfig.leagueId, info.league.id)),
    // Nothing has been bought yet (settings are locked otherwise), so every purse is the full purse.
    db.update(cricketTeamState).set({ purse: next.purse, spent: 0, updatedAt: now }).where(eq(cricketTeamState.leagueId, info.league.id)),
    bumpStateVersion(info.league.id),
  ]);
  return requireCricketLeague(info.league.id);
}

/** The admin's "Mark complete" (or reopen). The season also completes once every match is scored. */
export async function setLeagueComplete(leagueId: string, complete: boolean): Promise<void> {
  const info = await requireCricketLeague(leagueId);
  await db.batch([
    db
      .update(cricketLeagueConfig)
      .set({ completedAt: complete ? new Date() : null, updatedAt: new Date() })
      .where(eq(cricketLeagueConfig.leagueId, info.league.id)),
    bumpStateVersion(info.league.id),
  ]);
}

// ─── Manager Management ───────────────────────────────────────────────────────

export interface ManagerTeamRow {
  id: string;
  name: string;
  managers: Array<{ userId: string; name: string; username: string | null; email: string; role: "owner" | "member" }>;
  purse: number;
  spent: number;
  penaltySlots: number;
  squadSize: number;
  franchise: { code: string; name: string } | null;
}

/** Every team with who manages it, its money and squad, for the console's Manager Management tab. */
export async function listManagerTeams(leagueId: string): Promise<ManagerTeamRow[]> {
  const info = await requireCricketLeague(leagueId);
  const lid = info.league.id;
  const [teamRows, members, squads, franchises] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name, purse: cricketTeamState.purse, spent: cricketTeamState.spent, penaltySlots: cricketTeamState.penaltySlots })
      .from(teams)
      .innerJoin(cricketTeamState, eq(cricketTeamState.teamId, teams.id))
      .where(and(eq(teams.leagueId, lid), eq(teams.isGhost, false))),
    db
      .select({ teamId: teamMembers.teamId, userId: users.id, name: users.name, username: users.username, email: users.email, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.leagueId, lid)),
    db.select({ teamId: cricketSquadPlayers.teamId, n: count() }).from(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, lid)).groupBy(cricketSquadPlayers.teamId),
    db
      .select({ teamId: cricketFranchiseOwnership.teamId, code: cricketTeams.code, name: cricketTeams.name })
      .from(cricketFranchiseOwnership)
      .innerJoin(cricketTeams, eq(cricketTeams.id, cricketFranchiseOwnership.cricketTeamId))
      .where(eq(cricketFranchiseOwnership.leagueId, lid)),
  ]);
  const sizes = new Map(squads.map((s) => [s.teamId, s.n]));
  const franchiseOf = new Map(franchises.map((f) => [f.teamId, { code: f.code, name: f.name }]));
  return teamRows
    .map((t) => ({
      ...t,
      managers: members.filter((m) => m.teamId === t.id).map(({ teamId: _t, ...m }) => m).sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "owner" ? -1 : 1)),
      squadSize: sizes.get(t.id) ?? 0,
      franchise: franchiseOf.get(t.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Rename a team. Unique in the league (ignoring case); a franchise owner is still shown by the franchise's name. */
export async function renameTeam(leagueId: string, teamId: string, rawName: unknown): Promise<void> {
  const info = await requireCricketLeague(leagueId);
  const lid = info.league.id;
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (!name) throw new CricketAdminError("The team name is required", 400);
  if (name.length > 60) throw new CricketAdminError("The team name is too long (60 characters at most)", 400);
  const [team] = await db.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.leagueId, lid))).limit(1);
  if (!team) throw new CricketAdminError("That team isn't in this league", 404);
  const [clash] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, lid), ne(teams.id, teamId), sql`lower(${teams.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (clash) throw new CricketAdminError(`Another team is already called "${name}"`, 409);
  await db.batch([db.update(teams).set({ name }).where(eq(teams.id, teamId)), bumpStateVersion(lid)]);
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export interface FinanceRow {
  teamId: string;
  name: string;
  purse: number;
  spent: number;
  players: { count: number; spent: number };
  franchise: { name: string; price: number } | null;
  penalties: { incurred: number; redeemed: number; redemptionSpent: number; open: number };
}

/**
 * Where each team's money went: players, its franchise and penalty redemptions. `spent` is the
 * team's running total; the parts should add up to it (the console flags any team where they don't).
 */
export async function financeRows(leagueId: string): Promise<{ startingPurse: number; rows: FinanceRow[] }> {
  const info = await requireCricketLeague(leagueId);
  const lid = info.league.id;
  const [teamRows, squads, franchises, penalties] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name, purse: cricketTeamState.purse, spent: cricketTeamState.spent, penaltySlots: cricketTeamState.penaltySlots })
      .from(teams)
      .innerJoin(cricketTeamState, eq(cricketTeamState.teamId, teams.id))
      .where(and(eq(teams.leagueId, lid), eq(teams.isGhost, false))),
    db
      .select({ teamId: cricketSquadPlayers.teamId, n: count(), total: sql<number>`coalesce(sum(${cricketSquadPlayers.price}), 0)` })
      .from(cricketSquadPlayers)
      .where(eq(cricketSquadPlayers.leagueId, lid))
      .groupBy(cricketSquadPlayers.teamId),
    db
      .select({ teamId: cricketFranchiseOwnership.teamId, name: cricketTeams.name, price: cricketFranchiseOwnership.price })
      .from(cricketFranchiseOwnership)
      .innerJoin(cricketTeams, eq(cricketTeams.id, cricketFranchiseOwnership.cricketTeamId))
      .where(eq(cricketFranchiseOwnership.leagueId, lid)),
    db.select().from(cricketTeamPenalties).where(eq(cricketTeamPenalties.leagueId, lid)),
  ]);
  const squadOf = new Map(squads.map((s) => [s.teamId, { count: s.n, spent: Number(s.total) }]));
  const franchiseOf = new Map(franchises.map((f) => [f.teamId, { name: f.name, price: f.price }]));
  const rows = teamRows.map((t) => {
    const mine = penalties.filter((p) => p.teamId === t.id);
    const redeemed = mine.filter((p) => p.redeemedAt);
    return {
      teamId: t.id,
      name: t.name,
      purse: t.purse,
      spent: t.spent,
      players: squadOf.get(t.id) ?? { count: 0, spent: 0 },
      franchise: franchiseOf.get(t.id) ?? null,
      penalties: {
        incurred: mine.length,
        redeemed: redeemed.length,
        redemptionSpent: redeemed.reduce((s, p) => s + (p.redemptionPrice ?? 0), 0),
        open: t.penaltySlots,
      },
    };
  });
  return { startingPurse: info.config.purse, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) };
}
