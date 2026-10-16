/**
 * Cricket auction room helpers: the admin's "set who nominates next" plan, what a post-turn pause
 * shows (a sale or a missed turn), and the quick-bid amounts.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planSetNominator } from "../../src/lib/sports/cricket/auction/turns";
import { pickPauseOutcome, type OutcomeSale } from "../../src/lib/sports/cricket/auction/outcome";
import { jumpBids } from "../../src/lib/sports/cricket/auction/rules";

const ring = ["a", "b", "c", "d"];

test("set nominator: back and forward wrap around the ring", () => {
  assert.deepEqual(planSetNominator({ ring, cursor: 0, queueLength: 0, direction: "back" }), { ok: true, index: 3, ringReturnIndex: null });
  assert.deepEqual(planSetNominator({ ring, cursor: 3, queueLength: 0, direction: "forward" }), { ok: true, index: 0, ringReturnIndex: null });
  assert.deepEqual(planSetNominator({ ring, cursor: 1, queueLength: 0, direction: "forward" }), { ok: true, index: 2, ringReturnIndex: null });
});

test("set nominator: a named team; with owed make-up turns the ring resumes just before it", () => {
  assert.deepEqual(planSetNominator({ ring, cursor: 0, queueLength: 0, teamId: "c" }), { ok: true, index: 2, ringReturnIndex: null });
  // Two make-up turns are served first, then the ring continues after index 1 — i.e. with "c".
  assert.deepEqual(planSetNominator({ ring, cursor: 0, queueLength: 2, teamId: "c" }), { ok: true, index: 2, ringReturnIndex: 1 });
  assert.deepEqual(planSetNominator({ ring, cursor: 2, queueLength: 1, teamId: "a" }), { ok: true, index: 0, ringReturnIndex: 3 });
});

test("set nominator: unknown team, no direction and an empty ring are refused", () => {
  assert.deepEqual(planSetNominator({ ring, cursor: 0, queueLength: 0, teamId: "z" }), { ok: false, error: "That team isn't in this session" });
  assert.equal(planSetNominator({ ring, cursor: 0, queueLength: 0 }).ok, false);
  assert.equal(planSetNominator({ ring: [], cursor: 0, queueLength: 0, direction: "forward" }).ok, false);
});

const at = (s: number) => new Date(Date.UTC(2026, 9, 17, 12, 0, s));
const sale = (s: number): OutcomeSale => ({ lotId: "L1", kind: "player", name: "Virat Kohli", playerId: 7, cricketTeamId: null, teamId: "b", price: 1950, at: at(s), lotNumber: 4 });

test("pause outcome: a nomination followed by its sale is SOLD", () => {
  assert.deepEqual(pickPauseOutcome({ lastEvent: { event: "nominated", teamId: "a", at: at(0) }, lastSale: sale(25) }), {
    type: "sold",
    lotId: "L1",
    kind: "player",
    name: "Virat Kohli",
    playerId: 7,
    cricketTeamId: null,
    teamId: "b",
    price: 1950,
    lotNumber: 4,
  });
  assert.equal(pickPauseOutcome({ lastEvent: { event: "auto-nominated", teamId: "a", at: at(0) }, lastSale: sale(0) })?.type, "sold");
});

test("pause outcome: a missed turn is itself the outcome; a sale from before the nomination is not", () => {
  assert.deepEqual(pickPauseOutcome({ lastEvent: { event: "penalised", teamId: "c", at: at(30) }, lastSale: sale(25) }), { type: "penalised", teamId: "c" });
  assert.deepEqual(pickPauseOutcome({ lastEvent: { event: "skipped", teamId: "d", at: at(30) }, lastSale: null }), { type: "skipped", teamId: "d" });
  // The newest sale predates this nomination (the lot was cancelled): nothing to show.
  assert.equal(pickPauseOutcome({ lastEvent: { event: "nominated", teamId: "a", at: at(40) }, lastSale: sale(25) }), null);
  assert.equal(pickPauseOutcome({ lastEvent: null, lastSale: sale(25) }), null);
});

test("quick bids: the next bid, one step more and three steps more, on the ladder", () => {
  assert.deepEqual(jumpBids(20), [25, 30, 40]); // +5 L below ₹1 Cr
  assert.deepEqual(jumpBids(95), [100, 110, 130]); // the next bid crosses ₹1 Cr: +10 L steps
  assert.deepEqual(jumpBids(480), [500, 525, 575]); // +25 L from ₹5 Cr
});
