/**
 * The cricket room's feed lines and final results, built from the feed and the league view.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildCricketFeed } from "../../src/lib/sports/cricket/auction/feed-view";
import { cricketFinalResults } from "../../src/lib/sports/cricket/auction/results-view";
import type { SessionFeed } from "../../src/lib/sports/cricket/auction/feed";
import type { SnapshotLot } from "../../src/lib/sports/cricket/auction/snapshot";

const names: Record<string, string> = { a: "Afshaan", b: "Rahul" };
const words = { nameOf: (id: string | null | undefined) => (id ? (names[id] ?? "?") : "—"), money: (l: number) => `₹${l} L` };
const iso = (s: number) => new Date(Date.UTC(2026, 9, 17, 12, 0, s)).toISOString();

const feed: SessionFeed = {
  sessionId: "S",
  lots: [
    {
      id: "L1",
      lotNumber: 1,
      kind: "player",
      name: "Virat Kohli",
      playerId: 7,
      cricketTeamId: null,
      status: "sold",
      teamId: "b",
      price: 1950,
      nominatorTeamId: "a",
      at: iso(30),
      logs: [
        { teamId: "a", amount: 20, type: "nomination", at: iso(0) },
        { teamId: "b", amount: 1950, type: "bid", at: iso(5) },
        { teamId: "b", amount: 1950, type: "sold", at: iso(30) },
      ],
    },
  ],
  events: [{ id: "E1", event: "penalised", teamId: "a", at: iso(40), detail: null }],
};

test("feed: newest first — a missed turn, then the sale, which opens to its nomination and bids", () => {
  const entries = buildCricketFeed(feed, null, words);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.text]),
    [
      ["penalty", "Afshaan missed their turn — penalty slot"],
      ["sold", "SOLD: Virat Kohli → Rahul for ₹1950 L"],
    ],
  );
  assert.deepEqual(entries[1].children?.map((c) => c.text), ["Afshaan nominated at ₹20 L", "Rahul bid ₹1950 L"]);
});

test("feed: the open lot's bids come first, as they happen", () => {
  const lot = {
    id: "L2",
    name: "MS Dhoni",
    history: [
      { teamId: "b", amount: 20, type: "nomination", at: iso(50) },
      { teamId: "a", amount: 25, type: "bid", at: iso(52) },
    ],
  } as unknown as SnapshotLot;
  const entries = buildCricketFeed(feed, lot, words);
  assert.deepEqual(entries.slice(0, 2).map((e) => e.text), ["Afshaan bid ₹25 L on MS Dhoni", "Rahul nominated MS Dhoni at ₹20 L"]);
});

test("final results: players per team with prices and purse left; or the franchise each team bought", () => {
  const view = {
    realTeams: [{ id: 1, code: "RCB" }],
    teams: [
      { id: "a", name: "Afshaan", ownName: "Afshaan", purse: 5, franchise: null },
      { id: "b", name: "Royal Challengers", ownName: "Rahul", purse: 100, franchise: { id: 1, code: "RCB", name: "Royal Challengers", price: 900 } },
    ],
    players: [
      { id: 7, name: "Virat Kohli", teamId: 1, role: "BAT", overseas: false, ownerTeamId: "b", price: 1950 },
      { id: 8, name: "Faf du Plessis", teamId: 1, role: "BAT", overseas: true, ownerTeamId: null, price: null },
    ],
  } as unknown as Parameters<typeof cricketFinalResults>[0];

  const players = cricketFinalResults(view, "player");
  assert.deepEqual(players.map((t) => [t.id, t.countLabel, t.purseLeft]), [["a", "0 players", 5], ["b", "1 player", 100]]);
  assert.deepEqual(players[1].items, [{ id: "7", name: "Virat Kohli", price: 1950, role: "BAT", teamCode: "RCB", overseas: false }]);
  assert.equal(players[1].note, "Rahul · owns Royal Challengers");

  const franchises = cricketFinalResults(view, "franchise");
  assert.deepEqual(franchises.map((t) => [t.name, t.countLabel, t.items.map((i) => [i.name, i.price])]), [
    ["Afshaan", "No franchise", []],
    ["Rahul", "Franchise", [["Royal Challengers", 900]]],
  ]);
});
