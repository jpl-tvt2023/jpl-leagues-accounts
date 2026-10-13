/**
 * League-admin changes to a cricket league: its settings and the season's completion.
 *
 * Settings that shape the auction or the scoring (purse, squad rules, franchise auction and boost,
 * redeem price) are locked once any auction session exists — changing them mid-auction would be
 * unfair to whoever already bought. The timers only affect sessions not yet created, so they can
 * always change.
 */

import { count, eq } from "drizzle-orm";
import { db, cricketLeagueConfig, cricketTeamState, cricketAuctionSessions } from "@/lib/db";
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
