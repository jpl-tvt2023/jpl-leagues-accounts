/**
 * The cricket auction's rules as pure functions: the IPL-style bid ladder, the franchise auction's
 * rising floor, whether a team may add a player, and the most a team may bid while still being able
 * to complete its squad. Money is in lakhs. Unit-tested in tests/unit/cricket-auction-rules.test.ts.
 */

import type { CricketRole } from "@/lib/db/schema-cricket";
import { ROLES, ROLE_LABELS, type SquadRules } from "../squad-rules";

/** Bid step at a given current bid: +5 L under ₹1 Cr, +10 L to ₹2 Cr, +20 L to ₹5 Cr, +25 L above. */
export function bidStep(current: number): number {
  if (current < 100) return 5;
  if (current < 200) return 10;
  if (current < 500) return 20;
  return 25;
}

/** The smallest bid that beats `current`. */
export function nextMinBid(current: number): number {
  return current + bidStep(current);
}

/** Round up onto the ladder: the smallest amount ≥ `amount` that is a multiple of its own step. */
export function roundUpToLadder(amount: number): number {
  const step = bidStep(amount);
  return Math.ceil(amount / step) * step;
}

/**
 * A franchise's opening price: its base price, or the average price of franchises already sold in
 * this league (rounded up onto the ladder), whichever is higher — so the last franchises left are
 * never a bargain for whoever waited.
 */
export function franchiseOpeningPrice(basePrice: number, soldPrices: readonly number[]): number {
  if (soldPrices.length === 0) return basePrice;
  const avg = soldPrices.reduce((s, p) => s + p, 0) / soldPrices.length;
  return Math.max(basePrice, roundUpToLadder(avg));
}

export interface SquadState {
  size: number;
  roleCounts: Record<CricketRole, number>;
  /** Players per real team (cricket_teams.id). */
  perRealTeam: Map<number, number>;
  overseas: number;
}

export interface PlayerTraits {
  role: CricketRole;
  teamId: number;
  overseas: boolean;
}

export function emptySquad(): SquadState {
  return { size: 0, roleCounts: { WK: 0, BAT: 0, AR: 0, BOWL: 0 }, perRealTeam: new Map(), overseas: 0 };
}

export function squadStateOf(players: readonly PlayerTraits[]): SquadState {
  const s = emptySquad();
  for (const p of players) addToSquad(s, p);
  return s;
}

function addToSquad(s: SquadState, p: PlayerTraits): void {
  s.size++;
  s.roleCounts[p.role]++;
  s.perRealTeam.set(p.teamId, (s.perRealTeam.get(p.teamId) ?? 0) + 1);
  if (p.overseas) s.overseas++;
}

/** Squad slots a team may fill: the maximum less any unredeemed penalty slots. */
export function squadCap(rules: SquadRules, penaltySlots: number): number {
  return Math.max(0, rules.maxSize - penaltySlots);
}

/** Players still needed to reach the minimum squad, counting role minimums. */
export function playersStillNeeded(s: SquadState, rules: SquadRules): number {
  const roleShort = ROLES.reduce((sum, r) => sum + Math.max(0, rules.roleMin[r] - s.roleCounts[r]), 0);
  return Math.max(roleShort, rules.minSize - s.size, 0);
}

/** Whether `player` may join a squad in state `s`. */
export function canAddPlayer(
  s: SquadState,
  rules: SquadRules,
  penaltySlots: number,
  player: PlayerTraits,
): { ok: true } | { ok: false; error: string } {
  const cap = squadCap(rules, penaltySlots);
  if (s.size >= cap) return { ok: false, error: `Squad is full (${cap} players${penaltySlots ? `, ${penaltySlots} lost to penalties` : ""})` };
  const max = rules.roleMax[player.role];
  if (max !== null && s.roleCounts[player.role] >= max) return { ok: false, error: `Already ${max} ${ROLE_LABELS[player.role].toLowerCase()}s — the most allowed` };
  if (rules.maxPerRealTeam !== null && (s.perRealTeam.get(player.teamId) ?? 0) >= rules.maxPerRealTeam) {
    return { ok: false, error: `Already ${rules.maxPerRealTeam} players from that team — the most allowed` };
  }
  if (player.overseas && rules.maxOverseas !== null && s.overseas >= rules.maxOverseas) {
    return { ok: false, error: `Already ${rules.maxOverseas} overseas players — the most allowed` };
  }
  // The role minimums must still fit in the slots left after this player.
  const after: SquadState = { ...s, roleCounts: { ...s.roleCounts }, perRealTeam: new Map(s.perRealTeam) };
  addToSquad(after, player);
  const roleShort = ROLES.reduce((sum, r) => sum + Math.max(0, rules.roleMin[r] - after.roleCounts[r]), 0);
  if (roleShort > cap - after.size) {
    const short = ROLES.filter((r) => after.roleCounts[r] < rules.roleMin[r]).map((r) => `${rules.roleMin[r] - after.roleCounts[r]} ${r}`);
    return { ok: false, error: `That would leave ${cap - after.size} slot(s) for the ${short.join(", ")} you still need` };
  }
  return { ok: true };
}

/**
 * The most a team may bid: its purse less what it must keep to complete the minimum squad at the
 * cheapest available base price. `addsPlayer` is false for a franchise (it isn't a squad slot).
 */
export function maxAffordableBid(opts: {
  purse: number;
  squad: SquadState;
  rules: SquadRules;
  cheapestBasePrice: number;
  addsPlayer: boolean;
}): number {
  const needed = playersStillNeeded(opts.squad, opts.rules);
  const stillNeededAfter = Math.max(0, needed - (opts.addsPlayer ? 1 : 0));
  return opts.purse - stillNeededAfter * opts.cheapestBasePrice;
}
