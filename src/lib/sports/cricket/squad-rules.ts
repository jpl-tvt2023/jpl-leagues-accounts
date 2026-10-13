/**
 * A cricket league's squad rules: how big a squad is, how many of each role it needs and allows,
 * and the optional per-real-team and overseas caps. Set by the admin per league; stored as JSON in
 * cricket_league_config.squad_rules.
 *
 * Pure — the auction engine, the league settings form and the tests all share it.
 */

import type { CricketRole } from "@/lib/db/schema-cricket";

export const ROLES: readonly CricketRole[] = ["WK", "BAT", "AR", "BOWL"];

export const ROLE_LABELS: Record<CricketRole, string> = {
  WK: "Wicket-keeper",
  BAT: "Batter",
  AR: "All-rounder",
  BOWL: "Bowler",
};

export interface SquadRules {
  minSize: number;
  maxSize: number;
  roleMin: Record<CricketRole, number>;
  /** null = no upper limit for that role. */
  roleMax: Record<CricketRole, number | null>;
  /** Most players from one real team (franchise/country); null = no limit. */
  maxPerRealTeam: number | null;
  /** Most overseas players; null = no limit. */
  maxOverseas: number | null;
}

export const DEFAULT_SQUAD_RULES: SquadRules = {
  minSize: 15,
  maxSize: 18,
  roleMin: { WK: 1, BAT: 4, AR: 3, BOWL: 5 },
  roleMax: { WK: null, BAT: null, AR: null, BOWL: null },
  maxPerRealTeam: null,
  maxOverseas: null,
};

const LIMIT = 100;

function wholeOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function optionalWhole(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** Stored JSON (or a request body) → rules, filling anything missing from the defaults. */
export function parseSquadRules(raw: unknown): SquadRules {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") obj = parsed;
    } catch {
      /* fall back to defaults */
    }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  const roleMinIn = (obj.roleMin ?? {}) as Record<string, unknown>;
  const roleMaxIn = (obj.roleMax ?? {}) as Record<string, unknown>;
  const roleMin = {} as Record<CricketRole, number>;
  const roleMax = {} as Record<CricketRole, number | null>;
  for (const r of ROLES) {
    roleMin[r] = wholeOr(roleMinIn[r], DEFAULT_SQUAD_RULES.roleMin[r]);
    roleMax[r] = optionalWhole(roleMaxIn[r]);
  }
  return {
    minSize: wholeOr(obj.minSize, DEFAULT_SQUAD_RULES.minSize),
    maxSize: wholeOr(obj.maxSize, DEFAULT_SQUAD_RULES.maxSize),
    roleMin,
    roleMax,
    maxPerRealTeam: optionalWhole(obj.maxPerRealTeam),
    maxOverseas: optionalWhole(obj.maxOverseas),
  };
}

/** Problems that make the rules impossible to satisfy; empty when they're fine. */
export function squadRulesErrors(rules: SquadRules): string[] {
  const errors: string[] = [];
  const minRoles = ROLES.reduce((sum, r) => sum + rules.roleMin[r], 0);
  if (rules.minSize < 1 || rules.maxSize > LIMIT) errors.push(`Squad size must be between 1 and ${LIMIT}`);
  if (rules.minSize > rules.maxSize) errors.push("Minimum squad size is larger than the maximum");
  for (const r of ROLES) {
    if (rules.roleMin[r] < 0) errors.push(`${ROLE_LABELS[r]} minimum can't be negative`);
    const max = rules.roleMax[r];
    if (max !== null && max < rules.roleMin[r]) errors.push(`${ROLE_LABELS[r]} maximum is below its minimum`);
  }
  if (minRoles > rules.maxSize) errors.push(`The role minimums add up to ${minRoles}, more than the maximum squad size of ${rules.maxSize}`);
  if (ROLES.every((r) => rules.roleMax[r] !== null)) {
    const maxRoles = ROLES.reduce((sum, r) => sum + (rules.roleMax[r] ?? 0), 0);
    if (maxRoles < rules.minSize) errors.push(`The role maximums add up to ${maxRoles}, less than the minimum squad size of ${rules.minSize}`);
  }
  if (rules.maxPerRealTeam !== null && rules.maxPerRealTeam < 1) errors.push("Max players per team must be at least 1");
  if (rules.maxOverseas !== null && rules.maxOverseas < 0) errors.push("Max overseas players can't be negative");
  return errors;
}

/** A one-line summary, e.g. for the rules page: "15–18 players · 1+ WK · 4+ BAT · …". */
export function describeSquadRules(rules: SquadRules): string {
  const parts = [`${rules.minSize === rules.maxSize ? rules.minSize : `${rules.minSize}–${rules.maxSize}`} players`];
  for (const r of ROLES) {
    const min = rules.roleMin[r];
    const max = rules.roleMax[r];
    if (max !== null) parts.push(`${min}–${max} ${r}`);
    else if (min > 0) parts.push(`${min}+ ${r}`);
  }
  if (rules.maxPerRealTeam !== null) parts.push(`at most ${rules.maxPerRealTeam} from one team`);
  if (rules.maxOverseas !== null) parts.push(`at most ${rules.maxOverseas} overseas`);
  return parts.join(" · ");
}
