/**
 * The signed-in home page's pure step (src/lib/dashboard/overview.ts): to-dos, card order, the
 * summary tiles and the sport sections, from already-loaded league cards.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildOverview, cardHref, type H2hStatus, type MyLeagueCard, type OverviewInput } from "../../src/lib/dashboard/overview";

const NOW = new Date("2026-10-11T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function h2h(over: Partial<H2hStatus> = {}): H2hStatus {
  return {
    kind: "h2h",
    rank: 3,
    of: 16,
    groupName: "A",
    zone: "playoffs",
    stageComplete: false,
    leaguePoints: 12,
    played: 7,
    wins: 6,
    draws: 0,
    losses: 1,
    lastResult: { gw: 7, opponent: "Lions", home: true, outcome: "W", scored: 112, conceded: 98 },
    nextFixture: { gw: 8, opponent: "Tigers", home: false },
    captain: null,
    cup: null,
    ...over,
  };
}

let seq = 0;
function card(over: Partial<MyLeagueCard> = {}): MyLeagueCard {
  seq++;
  return {
    leagueId: `l${seq}`,
    slug: `league-${seq}`,
    name: `League ${seq}`,
    sport: "fpl",
    format: "tvt",
    season: "2026-27",
    isActive: true,
    teamSize: 16,
    relation: "team",
    isAdmin: false,
    teamName: "Rockets",
    role: "owner",
    needsSetup: false,
    isProfileComplete: true,
    hasPartnerSlot: true,
    pendingRequests: 0,
    nextDeadline: { gw: 8, at: inHours(30) },
    status: h2h(),
    error: false,
    ...over,
  };
}

function input(over: Partial<OverviewInput> = {}): OverviewInput {
  return {
    now: NOW,
    person: { name: "Asha Rao", username: "asha" },
    lastLeagueSlug: null,
    cards: [],
    others: [],
    pending: [],
    allLeagues: false,
    ...over,
  };
}

test("a missing captain with the window open is an urgent to-do with its deadline", () => {
  const c = card({ name: "JPL TVT", status: h2h({ captain: { gw: 8, deadline: inHours(5), set: false } }) });
  const { todo } = buildOverview(input({ cards: [c] }));
  assert.equal(todo.length, 1);
  assert.equal(todo[0].kind, "captain");
  assert.equal(todo[0].text, "Pick your captain for GW8");
  assert.equal(todo[0].href, `/${c.slug}/dashboard`);
  assert.equal(todo[0].dueAt, inHours(5));
  assert.equal(todo[0].urgent, true);
});

test("a captain already picked, or a passed deadline, is not a to-do", () => {
  const picked = card({ status: h2h({ captain: { gw: 8, deadline: inHours(5), set: true } }) });
  const passed = card({ status: h2h({ captain: { gw: 8, deadline: inHours(-1), set: false } }) });
  assert.equal(buildOverview(input({ cards: [picked, passed] })).todo.length, 0);
});

test("setup comes before the partner nudge, and only owners are asked to invite", () => {
  const setup = card({ needsSetup: true, status: null });
  const owner = card({ isProfileComplete: false, role: "owner" });
  const member = card({ isProfileComplete: false, role: "member" });
  const auctionOwner = card({ format: "auction", hasPartnerSlot: false, isProfileComplete: false, status: null });
  const kinds = buildOverview(input({ cards: [setup, owner, member, auctionOwner] })).todo.map((t) => `${t.kind}:${t.leagueName}`);
  assert.deepEqual(kinds.sort(), [`partner:${owner.name}`, `setup:${setup.name}`].sort());
});

test("auctions: live is urgent, one within a week is worth knowing, later ones are left out", () => {
  const auction = (state: "live" | "scheduled", at: string | null) =>
    card({
      format: "auction",
      hasPartnerSlot: false,
      status: { kind: "auction", rank: 1, of: 8, totalPoints: 300, purse: 5_000_000, squadSize: 15, lastGw: null, auction: { state, sessionId: "s", at } },
    });
  const live = auction("live", null);
  const soon = auction("scheduled", inHours(48));
  const later = auction("scheduled", inHours(24 * 10));
  const todo = buildOverview(input({ cards: [later, soon, live] })).todo;
  assert.deepEqual(todo.map((t) => t.kind), ["auction-live", "auction-soon"]);
  assert.equal(todo[0].urgent, true);
  assert.equal(todo[1].urgent, false);
});

test("admins see waiting join requests; their own pending requests show as not urgent", () => {
  const run = card({ relation: "admin", isAdmin: true, pendingRequests: 2, status: null, teamName: null });
  const out = buildOverview(
    input({ cards: [run], pending: [{ requestId: "r", leagueId: "lx", slug: "other", leagueName: "Other" }] }),
  );
  assert.deepEqual(
    out.todo.map((t) => [t.kind, t.text, t.urgent]),
    [
      ["join-requests", "2 join requests waiting for you", true],
      ["awaiting-approval", "Your request to join is waiting for the admin", false],
    ],
  );
  assert.equal(out.todo[0].href, `/admin/${run.leagueId}`);
});

test("urgent to-dos come first, soonest deadline first", () => {
  const late = card({ status: h2h({ captain: { gw: 8, deadline: inHours(20), set: false } }) });
  const early = card({ status: h2h({ captain: { gw: 8, deadline: inHours(2), set: false } }) });
  const info = card({ format: "auction", hasPartnerSlot: false, status: { kind: "auction", rank: 1, of: 8, totalPoints: 0, purse: 0, squadSize: 0, lastGw: null, auction: { state: "scheduled", sessionId: "s", at: inHours(1) } } });
  const todo = buildOverview(input({ cards: [late, info, early] })).todo;
  assert.deepEqual(todo.map((t) => t.leagueName), [early.name, late.name, info.name]);
});

test("cards: last-used league first, then ones with to-dos, then playing before running, then by name", () => {
  const b = card({ name: "B league" });
  const a = card({ name: "A league" });
  const admin = card({ name: "0 run", relation: "admin", isAdmin: true, status: null });
  const todo = card({ name: "Z needs captain", status: h2h({ captain: { gw: 8, deadline: inHours(3), set: false } }) });
  const last = card({ name: "Y opened last" });
  const out = buildOverview(input({ cards: [b, a, admin, todo, last], lastLeagueSlug: last.slug }));
  assert.deepEqual(out.sports[0].mine.map((c) => c.name), ["Y opened last", "Z needs captain", "A league", "B league", "0 run"]);
});

test("summary: distinct leagues, earliest future deadline, and the latest head-to-head week's record", () => {
  const w7 = card({ nextDeadline: { gw: 8, at: inHours(30) } });
  const l7 = card({ status: h2h({ lastResult: { gw: 7, opponent: "X", home: false, outcome: "L", scored: 80, conceded: 90 } }), nextDeadline: { gw: 8, at: inHours(6) } });
  const w6 = card({ status: h2h({ lastResult: { gw: 6, opponent: "Y", home: true, outcome: "W", scored: 90, conceded: 80 } }) });
  const runsAndPlays = card({ isAdmin: true });
  const classic = card({ relation: "classic", format: "fpl-classic", status: { kind: "classic", rank: 4, of: 50, totalPoints: 400, entryName: "E" }, nextDeadline: null });
  const s = buildOverview(input({ cards: [w7, l7, w6, runsAndPlays, classic] })).summary;
  assert.equal(s.leagues, 5);
  assert.equal(s.playing, 5);
  assert.equal(s.running, 1);
  assert.deepEqual(s.nextDeadline, { gw: 8, at: inHours(6) });
  // GW6's result isn't counted: only the latest gameweek any league has a result for.
  assert.deepEqual(s.lastGw, { gw: 7, wins: 2, draws: 0, losses: 1 });
});

test("a card that failed to load still appears, in its sport, without breaking the rest", () => {
  const broken = card({ status: null, error: true });
  const fine = card({ status: h2h({ captain: { gw: 8, deadline: inHours(4), set: false } }) });
  const out = buildOverview(input({ cards: [broken, fine] }));
  assert.equal(out.sports[0].mine.length, 2);
  assert.equal(out.todo.length, 1);
  assert.equal(out.summary.lastGw?.wins, 1);
});

test("sports: Football first; mine and others split per sport; a Football-only person gets one section", () => {
  const football = card({ sport: "fpl" });
  const cricketMine = card({ sport: "cricket", format: "auction", hasPartnerSlot: false, status: null });
  const other = { id: "o1", slug: "o1", name: "Box Cricket", sport: "cricket", format: "tvt", season: "2026", isActive: true, teamSize: 8 };
  const both = buildOverview(input({ cards: [cricketMine, football], others: [other] }));
  assert.deepEqual(both.sports.map((s) => s.label), ["Football", "Cricket"]);
  assert.deepEqual(both.sports[1].mine.map((c) => c.leagueId), [cricketMine.leagueId]);
  assert.deepEqual(both.sports[1].others.map((o) => o.id), ["o1"]);
  assert.equal(buildOverview(input({ cards: [football] })).sports.length, 1);
});

test("card links: setup until done, then the dashboard; admin and Classic cards go to their pages", () => {
  assert.equal(cardHref({ slug: "tvt", leagueId: "1", relation: "team", needsSetup: true }), "/tvt/setup");
  assert.equal(cardHref({ slug: "tvt", leagueId: "1", relation: "team", needsSetup: false }), "/tvt/dashboard");
  assert.equal(cardHref({ slug: "tvt", leagueId: "1", relation: "admin", needsSetup: false }), "/admin/1");
  assert.equal(cardHref({ slug: "fc", leagueId: "2", relation: "classic", needsSetup: false }), "/fc/standings");
});
