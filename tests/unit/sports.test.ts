/**
 * Sport labels and grouping (src/lib/sports/index.ts): every league list — home, landing page, league
 * picker — is grouped through this, Football first.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { compareSports, groupBySport, sportInfo } from "../../src/lib/sports";

test("known sports have a label and icon", () => {
  assert.deepEqual(sportInfo("fpl"), { sport: "fpl", label: "Football", icon: "⚽" });
  assert.deepEqual(sportInfo("cricket"), { sport: "cricket", label: "Cricket", icon: "🏏" });
});

test("an unknown sport still gets a readable label", () => {
  assert.deepEqual(sportInfo("kabaddi"), { sport: "kabaddi", label: "Kabaddi", icon: "🏆" });
  assert.equal(sportInfo("").label, "Other");
});

test("Football comes first, then the rest alphabetically", () => {
  assert.deepEqual(["cricket", "kabaddi", "fpl", "basketball"].sort(compareSports), ["fpl", "basketball", "cricket", "kabaddi"]);
});

test("groupBySport keeps each sport's items in arrival order and skips empty sports", () => {
  const items = [
    { id: "c1", sport: "cricket" },
    { id: "f1", sport: "fpl" },
    { id: "c2", sport: "cricket" },
    { id: "f2", sport: "fpl" },
  ];
  const groups = groupBySport(items);
  assert.deepEqual(groups.map((g) => g.label), ["Football", "Cricket"]);
  assert.deepEqual(groups[0].items.map((i) => i.id), ["f1", "f2"]);
  assert.deepEqual(groups[1].items.map((i) => i.id), ["c1", "c2"]);
  assert.deepEqual(groupBySport([]), []);
});
