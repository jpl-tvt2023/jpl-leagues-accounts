/**
 * Format registry (src/lib/sports/registry.ts) and the cricket page redirects
 * (src/lib/sports/cricket/routes.ts): what keeps a cricket league out of the FPL/TVT code paths.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CRICKET_AUCTION_FORMAT,
  NON_GAMEWEEK_FORMATS,
  SPORTS,
  formatBelongsToSport,
  formatCaps,
  formatsForSport,
  isCricketFormat,
  isKnownFormat,
  usesGameweeks,
} from "../../src/lib/sports/registry";
import { cricketRedirectTarget } from "../../src/lib/sports/cricket/routes";
import { sportInfo } from "../../src/lib/sports";
import { buildNavModel } from "../../src/lib/nav-links";

test("FPL formats run on gameweeks; fpl-classic and cricket don't", () => {
  for (const f of ["tvt", "continental-championship", "auction"]) assert.equal(usesGameweeks(f), true, f);
  assert.equal(usesGameweeks("fpl-classic"), false);
  assert.equal(usesGameweeks(CRICKET_AUCTION_FORMAT), false);
  assert.deepEqual([...NON_GAMEWEEK_FORMATS].sort(), ["cricket-auction", "fpl-classic"]);
});

test("cricket is its own sport, named-only setup, one person per team", () => {
  const caps = formatCaps(CRICKET_AUCTION_FORMAT);
  assert.equal(caps.sport, "cricket");
  assert.equal(caps.label, "Classic Cricket Auction");
  assert.equal(caps.maxTeamMembers, 1);
  assert.equal(caps.setupMode, "name-only");
  assert.equal(isCricketFormat(CRICKET_AUCTION_FORMAT), true);
  assert.equal(isCricketFormat("auction"), false);
  assert.deepEqual(formatsForSport("cricket"), [CRICKET_AUCTION_FORMAT]);
  assert.ok(!formatsForSport("fpl").includes(CRICKET_AUCTION_FORMAT));
});

test("every format belongs to exactly one sport, and sport labels come from the registry", () => {
  const all = Object.values(SPORTS).flatMap((s) => s.formats);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(formatsForSport("fpl"), ["tvt", "continental-championship", "auction", "fpl-classic"]);
  assert.deepEqual(formatsForSport("kabaddi"), []);
  assert.equal(formatBelongsToSport("auction", "fpl"), true);
  assert.equal(formatBelongsToSport("auction", "cricket"), false);
  assert.equal(formatBelongsToSport(CRICKET_AUCTION_FORMAT, "cricket"), true);
  assert.equal(formatCaps("tvt").sport, "fpl");
  assert.deepEqual(sportInfo("cricket"), { sport: "cricket", label: SPORTS.cricket.label, icon: SPORTS.cricket.icon });
});

test("team sizes match what membership used before the registry", () => {
  assert.equal(formatCaps("tvt").maxTeamMembers, 2);
  assert.equal(formatCaps("continental-championship").maxTeamMembers, 2);
  assert.equal(formatCaps("auction").maxTeamMembers, 1);
});

test("an unknown format keeps its old behaviour instead of being locked out", () => {
  assert.equal(isKnownFormat("grand-prix"), false);
  assert.equal(usesGameweeks("grand-prix"), true);
  assert.equal(formatCaps(null).maxTeamMembers, 1);
  assert.equal(isCricketFormat(undefined), false);
});

test("cricket pages and shared pages stay put", () => {
  assert.equal(cricketRedirectTarget("ipl", "/ipl/cricket/standings"), null);
  assert.equal(cricketRedirectTarget("ipl", "/ipl/cricket/auction/abc"), null);
  assert.equal(cricketRedirectTarget("ipl", "/ipl/feedback"), null);
  assert.equal(cricketRedirectTarget("ipl", "/ipl/team"), null);
  assert.equal(cricketRedirectTarget("ipl", "/ipl/setup"), null);
});

test("FPL pages redirect to their cricket counterpart, anything else to standings", () => {
  assert.equal(cricketRedirectTarget("ipl", "/ipl"), "/ipl/cricket/standings");
  assert.equal(cricketRedirectTarget("ipl", "/ipl/"), "/ipl/cricket/standings");
  assert.equal(cricketRedirectTarget("ipl", "/ipl/dashboard"), "/ipl/cricket/dashboard");
  assert.equal(cricketRedirectTarget("ipl", "/ipl/teams"), "/ipl/cricket/squads");
  assert.equal(cricketRedirectTarget("ipl", "/ipl/auction/sess-1"), "/ipl/cricket/auction");
  assert.equal(cricketRedirectTarget("ipl", "/ipl/playoffs"), "/ipl/cricket/standings");
  assert.equal(cricketRedirectTarget("ipl", "/ipl/jpl-cup-standings"), "/ipl/cricket/standings");
});

test("a slug that merely starts the same isn't this league", () => {
  assert.equal(cricketRedirectTarget("ipl", "/ipl-2026/standings"), null);
});

test("the cricket nav only links to cricket and shared pages", () => {
  const nav = buildNavModel({
    surface: "league",
    leagueSlug: "ipl",
    format: CRICKET_AUCTION_FORMAT,
    auctionTier: null,
    isLoggedIn: true,
    dashboardHref: "/ipl/dashboard",
    settingsHref: "/ipl/team",
  });
  for (const item of nav.flat) {
    assert.equal(cricketRedirectTarget("ipl", item.href), null, `${item.key} → ${item.href}`);
  }
  assert.equal(nav.flat.find((i) => i.key === "dashboard")?.href, "/ipl/cricket/dashboard");
  assert.deepEqual(nav.bottom.map((i) => i.key), ["dashboard", "standings", "auction", "squad"]);
});
