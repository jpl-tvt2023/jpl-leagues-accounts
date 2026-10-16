/**
 * The FPL auction room's extras: the latest sale (the SOLD moment) and the final results.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildFplFinalResults, latestSale, type FplHistoryBid } from "../../src/lib/sports/fpl/formats/auction/room-extras";

const bid = (id: string, status: string, at: string, over: Partial<FplHistoryBid> = {}): FplHistoryBid => ({
  id,
  playerName: `Player ${id}`,
  currentHighBid: 1_000_000,
  currentHighBidderId: "t1",
  status,
  updatedAt: at,
  ...over,
});

test("latest sale: the most recent sold lot, ignoring unsold ones", () => {
  const sale = latestSale([
    bid("a", "sold", "2026-10-17T12:00:00Z", { fplElementId: 10, lotNumber: 1 }),
    bid("b", "unsold", "2026-10-17T12:05:00Z"),
    bid("c", "sold", "2026-10-17T12:03:00Z", { fplElementId: 11, lotNumber: 2, currentHighBidderId: "t2", currentHighBid: 2_500_000 }),
  ]);
  assert.deepEqual(sale, { bidId: "c", fplElementId: 11, lotNumber: 2, playerName: "Player c", winnerId: "t2", price: 2_500_000, at: Date.parse("2026-10-17T12:03:00Z") });
  assert.equal(latestSale([bid("x", "unsold", "2026-10-17T12:00:00Z")]), null);
  assert.equal(latestSale(undefined), null);
});

test("final results: whole squads from the summaries (simulated auctions have no bids), this session's buys marked", () => {
  const teams = buildFplFinalResults({
    order: ["t2", "t1"],
    summaries: {
      t1: { purse: 5_000_000, players: [{ fplElementId: 10, playerName: "Saka", purchasePrice: 9_000_000 }, { fplElementId: 12, playerName: "Rice", purchasePrice: 6_000_000 }] },
      t2: { purse: 0, players: [] },
    },
    bids: [bid("a", "sold", "2026-10-17T12:00:00Z", { fplElementId: 12 }), bid("b", "unsold", "2026-10-17T12:01:00Z", { fplElementId: 13 })],
    clubAuction: false,
    nameOf: (id) => (id === "t1" ? "Arsenal FC" : "Spurs FC"),
    myTeamId: "t1",
  });
  assert.deepEqual(teams.map((t) => [t.name, t.isMe, t.countLabel, t.purseLeft]), [["Spurs FC", false, "0 players", 0], ["Arsenal FC", true, "2 players", 5_000_000]]);
  assert.deepEqual(teams[1].items.map((i) => [i.name, i.price, i.boughtHere]), [["Saka", 9_000_000, false], ["Rice", 6_000_000, true]]);
});

test("final results: a club auction shows the club each team bought", () => {
  const teams = buildFplFinalResults({
    order: ["t1", "t2"],
    summaries: { t1: { purse: 80_000_000, players: [] }, t2: { purse: 100_000_000, players: [] } },
    bids: [bid("c", "sold", "2026-10-17T12:00:00Z", { playerName: "Liverpool", currentHighBid: 20_000_000 })],
    clubAuction: true,
    nameOf: (id) => id,
    myTeamId: null,
  });
  assert.deepEqual(teams.map((t) => [t.id, t.countLabel, t.items.map((i) => i.name)]), [["t1", "Club", ["Liverpool"]], ["t2", "No club", []]]);
});
