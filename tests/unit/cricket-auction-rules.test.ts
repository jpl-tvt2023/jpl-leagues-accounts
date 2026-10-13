/**
 * Cricket auction rules (src/lib/sports/cricket/auction/rules.ts): bid ladder, rising franchise
 * floor, squad checks and the reserve rule. Also the squad-rules validation behind league settings.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  bidStep,
  canAddPlayer,
  franchiseOpeningPrice,
  maxAffordableBid,
  nextMinBid,
  playersStillNeeded,
  roundUpToLadder,
  squadStateOf,
} from "../../src/lib/sports/cricket/auction/rules";
import { DEFAULT_SQUAD_RULES, parseSquadRules, squadRulesErrors, type SquadRules } from "../../src/lib/sports/cricket/squad-rules";
import { validateCricketSettings, defaultCricketSettings } from "../../src/lib/sports/cricket/league-settings";

test("bid ladder: +5 L under 1 Cr, +10 L to 2 Cr, +20 L to 5 Cr, +25 L above", () => {
  assert.deepEqual([bidStep(20), bidStep(95), bidStep(100), bidStep(190), bidStep(200), bidStep(480), bidStep(500), bidStep(2000)], [5, 5, 10, 10, 20, 20, 25, 25]);
  assert.equal(nextMinBid(95), 100);
  assert.equal(nextMinBid(100), 110);
  assert.equal(nextMinBid(480), 500);
  assert.equal(nextMinBid(500), 525);
});

test("rounding onto the ladder", () => {
  assert.equal(roundUpToLadder(97), 100);
  assert.equal(roundUpToLadder(101), 110);
  assert.equal(roundUpToLadder(1234), 1250);
  assert.equal(roundUpToLadder(1250), 1250);
});

test("franchise floor: base price until something sells, then never below the average sold", () => {
  assert.equal(franchiseOpeningPrice(1000, []), 1000);
  assert.equal(franchiseOpeningPrice(1000, [1400, 1600]), 1500);
  assert.equal(franchiseOpeningPrice(1000, [1400, 1610]), 1525); // avg 1505 → 1525
  assert.equal(franchiseOpeningPrice(2000, [1400, 1600]), 2000); // a dearer base wins
});

const rules: SquadRules = {
  minSize: 5,
  maxSize: 6,
  roleMin: { WK: 1, BAT: 1, AR: 0, BOWL: 2 },
  roleMax: { WK: 2, BAT: null, AR: null, BOWL: null },
  maxPerRealTeam: 3,
  maxOverseas: 1,
};
const bat = (teamId = 1, overseas = false) => ({ role: "BAT" as const, teamId, overseas });

test("squad checks: cap, role max, per-team cap, overseas cap", () => {
  const s = squadStateOf([bat(1), bat(1), bat(1, true)]);
  assert.match(canAddPlayer(s, rules, 0, bat(1)).ok ? "" : (canAddPlayer(s, rules, 0, bat(1)) as { error: string }).error, /3 players from that team/);
  assert.match((canAddPlayer(s, rules, 0, bat(2, true)) as { error: string }).error, /1 overseas/);
  const wks = squadStateOf([{ role: "WK", teamId: 1, overseas: false }, { role: "WK", teamId: 2, overseas: false }]);
  assert.match((canAddPlayer(wks, rules, 0, { role: "WK", teamId: 3, overseas: false }) as { error: string }).error, /2 wicket-keepers/);
  assert.equal(canAddPlayer(squadStateOf([]), rules, 0, bat(2)).ok, true);
});

test("squad checks: role minimums must still fit, and penalties shrink the cap", () => {
  // 3 BAT in a 6-cap squad needing 1 WK + 2 BOWL: a 4th BAT leaves 2 slots for 3 needed.
  const s = squadStateOf([bat(1), bat(2), bat(3)]);
  assert.match((canAddPlayer(s, rules, 0, bat(4)) as { error: string }).error, /leave 2 slot/);
  assert.equal(canAddPlayer(s, rules, 0, { role: "BOWL", teamId: 4, overseas: false }).ok, true);
  // With a penalty the cap is 5: after 3 BAT + 1 BOWL only 1 slot is left for WK + BOWL.
  const s2 = squadStateOf([bat(1), bat(2), bat(3)]);
  assert.match((canAddPlayer(s2, rules, 1, { role: "BOWL", teamId: 4, overseas: false }) as { error: string }).error, /leave 1 slot/);
});

test("players still needed counts role minimums and the minimum size", () => {
  assert.equal(playersStillNeeded(squadStateOf([]), rules), 5);
  assert.equal(playersStillNeeded(squadStateOf([bat(1), bat(2), bat(3), bat(4)]), rules), 3); // WK + 2 BOWL
});

test("reserve rule: keep enough to complete the minimum squad at the cheapest price", () => {
  const empty = squadStateOf([]);
  // Buying a player: 4 more needed after it, at 20 each → keep 80.
  assert.equal(maxAffordableBid({ purse: 1000, squad: empty, rules, cheapestBasePrice: 20, addsPlayer: true }), 920);
  // Buying a franchise: all 5 still needed → keep 100.
  assert.equal(maxAffordableBid({ purse: 1000, squad: empty, rules, cheapestBasePrice: 20, addsPlayer: false }), 900);
  // Minimum met: the whole purse.
  const full = squadStateOf([{ role: "WK", teamId: 1, overseas: false }, bat(2), bat(3), { role: "BOWL", teamId: 4, overseas: false }, { role: "BOWL", teamId: 5, overseas: false }]);
  assert.equal(maxAffordableBid({ purse: 300, squad: full, rules, cheapestBasePrice: 20, addsPlayer: true }), 300);
});

test("squad rules: parsing fills defaults; impossible rules are reported", () => {
  assert.deepEqual(parseSquadRules("not json"), DEFAULT_SQUAD_RULES);
  assert.equal(parseSquadRules({ minSize: 11, roleMax: { WK: 2 } }).roleMax.WK, 2);
  assert.deepEqual(squadRulesErrors(DEFAULT_SQUAD_RULES), []);
  assert.ok(squadRulesErrors({ ...DEFAULT_SQUAD_RULES, minSize: 20, maxSize: 18 }).some((e) => /larger than the maximum/.test(e)));
  assert.ok(squadRulesErrors({ ...DEFAULT_SQUAD_RULES, maxSize: 10, roleMin: { WK: 3, BAT: 4, AR: 2, BOWL: 3 } }).some((e) => /add up to 12/.test(e)));
});

test("league settings: a window tournament can't run a franchise auction", () => {
  const s = { ...defaultCricketSettings("t1") };
  assert.equal(validateCricketSettings(s, { tournamentKind: "league" }).ok, true);
  const w = validateCricketSettings(s, { tournamentKind: "window" });
  assert.equal(w.ok, false);
  assert.equal(validateCricketSettings({ ...s, franchiseAuctionEnabled: false }, { tournamentKind: "window" }).ok, true);
  assert.equal(validateCricketSettings(s, { tournamentKind: null }).ok, false);
});
