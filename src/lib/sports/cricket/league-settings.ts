/**
 * A cricket league's settings as the create wizard and the admin console edit them, and their
 * validation. Pure (no DB), so the forms can share the defaults.
 *
 * Money is in lakhs (100 = ₹1 Cr).
 */

import { DEFAULT_SQUAD_RULES, parseSquadRules, squadRulesErrors, type SquadRules } from "./squad-rules";

export interface CricketLeagueSettings {
  tournamentId: string;
  /** Each team's starting purse, lakhs. */
  purse: number;
  squadRules: SquadRules;
  franchiseAuctionEnabled: boolean;
  /** Extra % on the points of players from the team's own franchise (20 → ×1.2). */
  franchiseBoostPercent: number;
  /** What clearing one penalty slot costs during the player auction, lakhs. */
  penaltyRedeemPrice: number;
  bidTimerSeconds: number;
  nominationTimeoutSeconds: number;
}

export function defaultCricketSettings(tournamentId = ""): CricketLeagueSettings {
  return {
    tournamentId,
    purse: 10_000, // ₹100 Cr
    squadRules: { ...DEFAULT_SQUAD_RULES, roleMin: { ...DEFAULT_SQUAD_RULES.roleMin }, roleMax: { ...DEFAULT_SQUAD_RULES.roleMax } },
    franchiseAuctionEnabled: true,
    franchiseBoostPercent: 20,
    penaltyRedeemPrice: 50,
    bidTimerSeconds: 20,
    nominationTimeoutSeconds: 60,
  };
}

export const MAX_CRICKET_MANAGERS = 30;

function wholeIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/**
 * Check settings from a request. `tournamentKind` decides whether a franchise auction is possible
 * (only "league" tournaments have franchises).
 */
export function validateCricketSettings(
  input: unknown,
  ctx: { tournamentKind: "league" | "window" | null },
): { ok: true; value: CricketLeagueSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Cricket settings are required" };
  const o = input as Record<string, unknown>;
  const tournamentId = typeof o.tournamentId === "string" ? o.tournamentId : "";
  if (!tournamentId) return { ok: false, error: "Pick the tournament this league plays" };
  if (ctx.tournamentKind === null) return { ok: false, error: "That tournament doesn't exist" };

  const purse = wholeIn(o.purse, 1, 1_000_000);
  if (purse === null) return { ok: false, error: "Purse must be a whole number of lakhs, at least 1" };
  const boost = typeof o.franchiseBoostPercent === "number" && o.franchiseBoostPercent >= 0 && o.franchiseBoostPercent <= 500 ? o.franchiseBoostPercent : null;
  if (boost === null) return { ok: false, error: "Franchise boost must be between 0 and 500 %" };
  const redeem = wholeIn(o.penaltyRedeemPrice, 0, 1_000_000);
  if (redeem === null) return { ok: false, error: "Penalty redeem price must be a whole number of lakhs" };
  const bidTimer = wholeIn(o.bidTimerSeconds ?? 20, 5, 600);
  if (bidTimer === null) return { ok: false, error: "Bid timer must be 5–600 seconds" };
  const nominationTimer = wholeIn(o.nominationTimeoutSeconds ?? 60, 10, 3600);
  if (nominationTimer === null) return { ok: false, error: "Nomination timer must be 10–3600 seconds" };

  const franchise = o.franchiseAuctionEnabled === true;
  if (franchise && ctx.tournamentKind !== "league") {
    return { ok: false, error: "Only league tournaments (like the IPL) have franchises to auction" };
  }
  const squadRules = parseSquadRules(o.squadRules);
  const ruleErrors = squadRulesErrors(squadRules);
  if (ruleErrors.length) return { ok: false, error: ruleErrors[0] };

  // The cheapest possible squad must fit in the purse: every slot at the smallest base price of
  // 1 lakh is the floor no real pool can go under.
  if (squadRules.minSize > purse) return { ok: false, error: "The purse can't buy a minimum squad even at 1 lakh a player" };

  return {
    ok: true,
    value: {
      tournamentId,
      purse,
      squadRules,
      franchiseAuctionEnabled: franchise,
      franchiseBoostPercent: boost,
      penaltyRedeemPrice: redeem,
      bidTimerSeconds: bidTimer,
      nominationTimeoutSeconds: nominationTimer,
    },
  };
}
