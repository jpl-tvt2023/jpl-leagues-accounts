/**
 * Which fixture the Match Center opens on from the nav (src/lib/sports/fpl/match-center/default-fixture.ts).
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { pickDefaultFixture, type DefaultFixtureCandidate } from "../../src/lib/sports/fpl/match-center/default-fixture";

// Deadlines a week apart: GW8 26 Sep, GW9 3 Oct, GW10 10 Oct.
const deadline = (gw: number) => new Date(Date.UTC(2026, 7, 1) + gw * 7 * 86_400_000);
const NOW = new Date("2026-10-05T12:00:00Z");

function fx(id: string, gw: number, home: string, away: string, over: Partial<DefaultFixtureCandidate> = {}): DefaultFixtureCandidate {
  return { id, gw, deadline: deadline(gw), homeTeamId: home, awayTeamId: away, isLeagueFixture: true, isChallenge: false, ...over };
}

// GW9's deadline has passed; GW10's hasn't.
const fixtures = [
  fx("g8-a", 8, "t1", "t2"),
  fx("g9-a", 9, "t3", "t4"),
  fx("g9-b", 9, "t5", "t1"),
  fx("g10-a", 10, "t1", "t3"),
];

test("the viewer's own match in the gameweek in play", () => {
  assert.equal(pickDefaultFixture(fixtures, NOW, "t1")?.id, "g9-b");
});

test("no team in the league: the gameweek's first match", () => {
  assert.equal(pickDefaultFixture(fixtures, NOW, null)?.id, "g9-a");
});

test("no match this gameweek (eliminated, blank week): their most recent match", () => {
  assert.equal(pickDefaultFixture(fixtures, NOW, "t2")?.id, "g8-a");
});

test("before the season starts: the first gameweek (its first match if the viewer isn't in it)", () => {
  const preseason = new Date("2026-08-01T00:00:00Z");
  assert.equal(pickDefaultFixture(fixtures, preseason, "t2")?.id, "g8-a");
  assert.equal(pickDefaultFixture(fixtures, preseason, "t3")?.id, "g8-a");
});

test("cup fixtures are ignored, and a regular match beats a challenge one", () => {
  const withCup = [
    fx("cup", 9, "t1", "t9", { isLeagueFixture: false }),
    fx("chal", 9, "t1", "t7", { isChallenge: true }),
    fx("reg", 9, "t1", "t2"),
  ];
  assert.equal(pickDefaultFixture(withCup, NOW, "t1")?.id, "reg");
  assert.equal(pickDefaultFixture([fx("cup", 9, "t1", "t9", { isLeagueFixture: false })], NOW, "t1"), null);
});
