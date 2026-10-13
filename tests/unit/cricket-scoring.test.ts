/**
 * Classic Cricket Auction scoring (src/lib/sports/cricket/scoring.ts): every squad player counts,
 * the franchise boost applies to own-franchise players (negatives included), and the tiebreakers.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { computeCricketStandings, type ScoringInput } from "../../src/lib/sports/cricket/scoring";

const MI = 1;
const CSK = 2;

function base(): ScoringInput {
  return {
    teams: [
      { id: "a", name: "Alpha", purse: 100 },
      { id: "b", name: "Bravo", purse: 50 },
    ],
    players: [
      { id: 10, teamId: MI },
      { id: 11, teamId: CSK },
      { id: 20, teamId: CSK },
      { id: 21, teamId: MI },
    ],
    squads: [
      { teamId: "a", playerId: 10 },
      { teamId: "a", playerId: 11 },
      { teamId: "b", playerId: 20 },
      { teamId: "b", playerId: 21 },
    ],
    franchises: [],
    points: [],
    fixtures: [
      { id: 1, status: "completed", pointsUploadedAt: new Date() },
      { id: 2, status: "scheduled", pointsUploadedAt: null },
    ],
    boostPercent: 20,
    completedAt: null,
  };
}

test("every squad player's points count; nobody else's do", () => {
  const input = base();
  input.points = [
    { fixtureId: 1, playerId: 10, points: 30 },
    { fixtureId: 1, playerId: 11, points: 12.5 },
    { fixtureId: 1, playerId: 99, points: 500 }, // not in any squad
  ];
  const { rows } = computeCricketStandings(input);
  const alpha = rows.find((r) => r.teamId === "a")!;
  assert.equal(alpha.total, 42.5);
  assert.equal(alpha.synergy, 0);
  assert.equal(alpha.topScorerId, 10);
  assert.deepEqual(alpha.fixtures, [{ fixtureId: 1, raw: 42.5, synergy: 0, total: 42.5 }]);
});

test("the franchise boost applies to own-franchise players only, negatives included", () => {
  const input = base();
  input.franchises = [{ teamId: "a", cricketTeamId: MI }];
  input.points = [
    { fixtureId: 1, playerId: 10, points: 50 }, // MI, boosted: +10
    { fixtureId: 2, playerId: 10, points: -5 }, // MI, boosted: -1
    { fixtureId: 1, playerId: 11, points: 10 }, // CSK, not boosted
  ];
  const alpha = computeCricketStandings(input).rows.find((r) => r.teamId === "a")!;
  assert.equal(alpha.raw, 55);
  assert.equal(alpha.synergy, 9);
  assert.equal(alpha.total, 64);
  const p10 = alpha.players.find((p) => p.playerId === 10)!;
  assert.equal(p10.boosted, true);
  assert.equal(p10.total, 54);
  assert.equal(p10.matches, 2);
  assert.equal(alpha.players.find((p) => p.playerId === 11)!.boosted, false);
});

test("tiebreakers: total, then synergy, then top scorer, then purse; still level shares the rank", () => {
  const input = base();
  // Both on 40. Alpha gets 8 of it from synergy, Bravo none → Alpha first.
  input.franchises = [{ teamId: "a", cricketTeamId: MI }];
  input.points = [
    { fixtureId: 1, playerId: 10, points: 40 / 1.2 }, // 33.333 + 6.667 synergy
    { fixtureId: 1, playerId: 20, points: 20 },
    { fixtureId: 1, playerId: 21, points: 20 },
  ];
  let { rows } = computeCricketStandings(input);
  assert.deepEqual(rows.map((r) => [r.teamId, r.total, r.rank]), [["a", 40, 1], ["b", 40, 2]]);

  // No synergy: equal totals → higher top scorer wins.
  input.franchises = [];
  input.points = [
    { fixtureId: 1, playerId: 10, points: 30 },
    { fixtureId: 1, playerId: 11, points: 10 },
    { fixtureId: 1, playerId: 20, points: 20 },
    { fixtureId: 1, playerId: 21, points: 20 },
  ];
  rows = computeCricketStandings(input).rows;
  assert.deepEqual(rows.map((r) => r.teamId), ["a", "b"]);

  // Same top scorer too → more purse left wins (Alpha has 100, Bravo 50).
  input.points = [
    { fixtureId: 1, playerId: 10, points: 25 },
    { fixtureId: 1, playerId: 11, points: 15 },
    { fixtureId: 1, playerId: 20, points: 25 },
    { fixtureId: 1, playerId: 21, points: 15 },
  ];
  input.teams[1].purse = 100;
  rows = computeCricketStandings(input).rows;
  assert.deepEqual(rows.map((r) => [r.rank, r.tied]), [[1, true], [1, true]]);
});

test("complete once every fixture that isn't abandoned has points, or when marked complete", () => {
  const input = base();
  assert.equal(computeCricketStandings(input).complete, false);
  input.fixtures[1].status = "abandoned";
  const s = computeCricketStandings(input);
  assert.deepEqual([s.fixturesScored, s.fixturesTotal, s.complete], [1, 1, true]);
  const marked = base();
  marked.completedAt = new Date();
  assert.equal(computeCricketStandings(marked).complete, true);
});

test("an empty league scores zero and isn't complete", () => {
  const s = computeCricketStandings({ ...base(), squads: [], fixtures: [] });
  assert.equal(s.complete, false);
  assert.ok(s.rows.every((r) => r.total === 0 && r.topScorerId === null));
});
