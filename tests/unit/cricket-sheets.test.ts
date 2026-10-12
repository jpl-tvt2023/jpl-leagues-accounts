/**
 * Cricket tournament upload sheets (src/lib/cricket/sheets/*): column aliases, IST times, row
 * validation, and the full-list / per-fixture replace plans.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapSheet } from "../../src/lib/cricket/sheets/columns";
import { formatIst, parseClock, parseIstDateTime } from "../../src/lib/cricket/sheets/ist";
import { parseTeamsSheet, planTeams } from "../../src/lib/cricket/sheets/teams";
import { parsePlayersSheet, parseRole, planPlayers, type ExistingPlayer } from "../../src/lib/cricket/sheets/players";
import { parseFixturesSheet, parseMatchFormat, planFixtures, type ExistingFixture } from "../../src/lib/cricket/sheets/fixtures";
import { parsePointsSheet, type PointsFixture } from "../../src/lib/cricket/sheets/points";
import { blockingIssues } from "../../src/lib/cricket/sheets/types";

const errors = (issues: { level: string; message: string }[]) => issues.filter((i) => i.level === "error").map((i) => i.message);

// ─── IST ─────────────────────────────────────────────────────────────────────

test("IST text, day-first text and Excel serials all land on the same UTC instant", () => {
  const iso = parseIstDateTime("2026-04-12 19:30");
  assert.ok(iso);
  assert.equal(iso.date.toISOString(), "2026-04-12T14:00:00.000Z");
  assert.equal(iso.hasTime, true);
  assert.equal(parseIstDateTime("12/04/2026 7:30 PM")?.date.toISOString(), "2026-04-12T14:00:00.000Z");
  assert.equal(parseIstDateTime("12-04-2026 19:30")?.date.toISOString(), "2026-04-12T14:00:00.000Z");
  // 2026-04-12 is Excel day 46124; 19:30 is 0.8125 of a day.
  assert.equal(parseIstDateTime(46124.8125)?.date.toISOString(), "2026-04-12T14:00:00.000Z");
  assert.equal(formatIst(iso.date), "2026-04-12 19:30");
});

test("a separate time column fills in the time; a date alone is midnight IST", () => {
  assert.equal(parseIstDateTime("2026-04-12", "15:30")?.date.toISOString(), "2026-04-12T10:00:00.000Z");
  assert.equal(parseIstDateTime(46124, 0.8125)?.date.toISOString(), "2026-04-12T14:00:00.000Z");
  const dateOnly = parseIstDateTime("2026-04-12");
  assert.equal(dateOnly?.hasTime, false);
  assert.equal(dateOnly?.date.toISOString(), "2026-04-11T18:30:00.000Z");
});

test("impossible dates and times are rejected", () => {
  assert.equal(parseIstDateTime("2026-02-30 19:30"), null);
  assert.equal(parseIstDateTime("2026-04-12 25:00"), null);
  assert.equal(parseIstDateTime("next tuesday"), null);
  assert.equal(parseIstDateTime(""), null);
  assert.equal(parseClock("7"), null);
  assert.deepEqual(parseClock("12:15 am"), [0, 15]);
  assert.deepEqual(parseClock("12 pm"), [12, 0]);
});

// ─── columns ─────────────────────────────────────────────────────────────────

test("headers match regardless of case, spaces and underscores, and aliases work", () => {
  const { rows, missing, unknown } = mapSheet("players", [
    { "Player ID": "P1", Name: "Rohit", Franchise: "MI", Position: "Batter", Price: 200, "T20I": 14, Notes: "x" },
  ]);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, ["Notes"]);
  assert.equal(rows[0].values.code, "P1");
  assert.equal(rows[0].values.team, "MI");
  assert.equal(rows[0].values.t20, 14);
});

test("missing required columns are reported by their template name", () => {
  const { issues } = parsePlayersSheet([{ player_id: "P1", name: "A" }], { teamCodes: new Set(["MI"]) });
  assert.deepEqual(errors(issues), ['Missing column "team"', 'Missing column "role"', 'Missing column "base_price"']);
});

// ─── teams ───────────────────────────────────────────────────────────────────

test("teams: codes are upper-cased, duplicates and bad prices are errors", () => {
  const { rows, issues } = parseTeamsSheet([
    { team_code: "mi", name: "Mumbai Indians", base_price: 1500, __row: 2 },
    { team_code: "CSK", name: "Chennai Super Kings", __row: 3 },
    { team_code: "MI", name: "Dup", base_price: 1, __row: 4 },
    { team_code: "RCB", name: "Bengaluru", base_price: 12.5, __row: 5 },
  ]);
  assert.deepEqual(rows.map((r) => [r.code, r.basePrice]), [["MI", 1500], ["CSK", 0]]);
  assert.deepEqual(errors(issues), ["Team MI is already on row 2", "base_price must be a whole number of lakhs"]);
  assert.deepEqual(issues.filter((i) => i.level === "error").map((i) => i.row), [4, 5]);
});

test("teams plan: insert, update, keep, and refuse to delete a team still in use", () => {
  const plan = planTeams(
    [
      { id: 1, code: "MI", name: "Mumbai Indians", basePrice: 1500 },
      { id: 2, code: "CSK", name: "Chennai", basePrice: 1500 },
      { id: 3, code: "GT", name: "Gujarat", basePrice: 1000 },
      { id: 4, code: "XX", name: "Gone", basePrice: 0 },
    ],
    [
      { row: 2, code: "MI", name: "Mumbai Indians", basePrice: 1500 },
      { row: 3, code: "CSK", name: "Chennai Super Kings", basePrice: 1600 },
      { row: 4, code: "KKR", name: "Kolkata", basePrice: 1200 },
    ],
    { referencedTeamIds: new Set([3]), franchiseAuctionStarted: true },
  );
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.updates.map((u) => u.id), [2]);
  assert.deepEqual(plan.inserts.map((r) => r.code), ["KKR"]);
  assert.deepEqual(plan.deletes, [4]);
  assert.match(errors(plan.issues)[0], /Team GT is missing/);
  assert.equal(plan.issues.filter((i) => i.level === "warning").length, 1); // CSK price after franchise auction
});

// ─── players ─────────────────────────────────────────────────────────────────

test("roles: common spellings map to WK / BAT / AR / BOWL", () => {
  assert.equal(parseRole("Wicket-keeper"), "WK");
  assert.equal(parseRole("WK Batter"), "WK");
  assert.equal(parseRole("batsman"), "BAT");
  assert.equal(parseRole("All Rounder"), "AR");
  assert.equal(parseRole("Bowler"), "BOWL");
  assert.equal(parseRole("captain"), null);
});

test("players: defaults, flags and every kind of bad cell", () => {
  const teamCodes = new Set(["MI", "CSK"]);
  const { rows, issues } = parsePlayersSheet(
    [
      { player_id: "P1", name: "Rohit Sharma", team: "mi", role: "BAT", base_price: 1600, overseas: "", Test: "", ODI: 0, T20: 14, __row: 2 },
      { player_id: "P2", name: "Pat Cummins", team: "CSK", role: "bowler", base_price: "1,800", overseas: "Yes", T20: 14, __row: 3 },
      { player_id: "P3", name: "X", team: "RCB", role: "BAT", base_price: 20, __row: 4 },
      { player_id: "P4", name: "Y", team: "MI", role: "keeper-ish", base_price: 0, overseas: "maybe", T20: -1, __row: 5 },
      { player_id: "P1", name: "rohit sharma", team: "MI", role: "BAT", base_price: 20, __row: 6 },
    ],
    { teamCodes },
  );
  assert.deepEqual(rows.map((r) => r.code), ["P1", "P2"]);
  assert.deepEqual(rows[0], { row: 2, code: "P1", name: "Rohit Sharma", teamCode: "MI", role: "BAT", basePrice: 1600, overseas: false, matchesTest: 0, matchesOdi: 0, matchesT20: 14 });
  assert.equal(rows[1].overseas, true);
  assert.equal(rows[1].basePrice, 1800);
  const errs = errors(issues);
  assert.ok(errs.includes("Team RCB isn't in the Teams sheet"));
  assert.ok(errs.includes('Role "keeper-ish" isn\'t WK, BAT, AR or BOWL'));
  assert.ok(errs.includes("base_price must be a whole number of lakhs, at least 1"));
  assert.ok(errs.includes('overseas "maybe" should be Y or N'));
  assert.ok(errs.includes("T20 must be a whole number"));
  assert.ok(errs.includes("player_id P1 is already on row 2"));
  assert.equal(issues.filter((i) => i.level === "warning").length, 1); // same name as row 2
});

test("players need the Teams sheet first", () => {
  const { issues } = parsePlayersSheet([{ player_id: "P1", name: "A", team: "MI", role: "BAT", base_price: 20 }], { teamCodes: new Set() });
  assert.match(errors(issues)[0], /Upload the Teams sheet first/);
});

test("players plan: moving an owned player is an overridable error; deleting one with points is not allowed", () => {
  const base: Omit<ExistingPlayer, "id" | "code" | "name"> = { teamId: 1, role: "BAT", basePrice: 100, overseas: false, matchesTest: 0, matchesOdi: 0, matchesT20: 14 };
  const plan = planPlayers(
    [
      { id: 10, code: "P1", name: "Owned", ...base },
      { id: 11, code: "P2", name: "Scored", ...base },
      { id: 12, code: "P3", name: "Free", ...base },
    ],
    [{ row: 2, code: "P1", name: "Owned", teamCode: "CSK", role: "BAT", basePrice: 100, overseas: false, matchesTest: 0, matchesOdi: 0, matchesT20: 14 }],
    { teamIdByCode: new Map([["MI", 1], ["CSK", 2]]), playersWithPoints: new Set([11]), ownedPlayerIds: new Set([10]), auctionStarted: true },
  );
  assert.deepEqual(plan.deletes, [12]);
  const moved = plan.issues.find((i) => i.row === 2);
  assert.equal(moved?.overridable, true);
  assert.equal(blockingIssues(plan.issues, false).length, 2);
  assert.equal(blockingIssues(plan.issues, true).length, 1); // the scored player still blocks
});

// ─── fixtures ────────────────────────────────────────────────────────────────

test("match formats", () => {
  assert.equal(parseMatchFormat("T20I"), "T20");
  assert.equal(parseMatchFormat("Twenty20"), "T20");
  assert.equal(parseMatchFormat("one day"), "ODI");
  assert.equal(parseMatchFormat("Test match"), "Test");
  assert.equal(parseMatchFormat("Hundred"), null);
});

test("fixtures: ids restart in each series; a duplicate within one series is an error", () => {
  const teamCodes = new Set(["IND", "AUS", "ENG"]);
  const { rows, issues } = parseFixturesSheet(
    [
      { series: "IND v AUS ODIs", fixture_id: 1, format: "ODI", team_a: "IND", team_b: "AUS", start_time_ist: "2026-01-10 13:30", __row: 2 },
      { series: "ENG v IND Tests", fixture_id: 1, format: "Test", team_a: "ENG", team_b: "IND", start_time_ist: "2026-02-01", time: "15:30", __row: 3 },
      { series: "ind v aus  odis", fixture_id: 1, format: "ODI", team_a: "IND", team_b: "AUS", start_time_ist: "2026-01-12 13:30", __row: 4 },
      { series: "IND v AUS ODIs", fixture_id: 2, format: "ODI", team_a: "IND", team_b: "IND", start_time_ist: "soon", __row: 5 },
    ],
    { teamCodes },
  );
  assert.deepEqual(rows.map((r) => `${r.series}#${r.fixtureNo}`), ["IND v AUS ODIs#1", "ENG v IND Tests#1"]);
  assert.equal(rows[1].startsAt.toISOString(), "2026-02-01T10:00:00.000Z");
  const errs = errors(issues);
  assert.ok(errs.includes("ind v aus odis fixture 1 is already on row 2"));
  assert.ok(errs.includes("IND can't play itself"));
  assert.ok(errs.some((e) => e.startsWith('Can\'t read the start "soon"')));
});

test("fixtures plan: a scored fixture can't change teams or disappear", () => {
  const existing: ExistingFixture[] = [
    { id: 1, series: "IPL 2026", fixtureNo: 1, matchFormat: "T20", teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-28T14:00:00Z"), venue: null, hasPoints: true },
    { id: 2, series: "IPL 2026", fixtureNo: 2, matchFormat: "T20", teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-29T14:00:00Z"), venue: null, hasPoints: true },
    { id: 3, series: "IPL 2026", fixtureNo: 3, matchFormat: "T20", teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-30T14:00:00Z"), venue: null, hasPoints: false },
  ];
  const plan = planFixtures(
    existing,
    [{ row: 2, series: "IPL 2026", fixtureNo: 1, matchFormat: "T20", teamACode: "MI", teamBCode: "KKR", startsAt: new Date("2026-03-28T14:00:00Z"), venue: null }],
    { teamIdByCode: new Map([["MI", 1], ["CSK", 2], ["KKR", 3]]) },
  );
  assert.deepEqual(plan.deletes, [3]);
  assert.equal(plan.updates.length, 0);
  assert.equal(errors(plan.issues).length, 2); // fixture 1 changes teams, fixture 2 disappears
});

// ─── points ──────────────────────────────────────────────────────────────────

const fixtures: PointsFixture[] = [
  { id: 1, series: "IPL 2026", fixtureNo: 1, teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-28T14:00:00Z"), status: "scheduled" },
  { id: 2, series: "IPL 2026", fixtureNo: 2, teamAId: 3, teamBId: 1, startsAt: new Date("2026-12-01T14:00:00Z"), status: "abandoned" },
];
const players = [
  { id: 100, code: "P1", name: "Rohit", teamId: 1 },
  { id: 101, code: "P2", name: "Dhoni", teamId: 2 },
  { id: 102, code: "P3", name: "Russell", teamId: 3 },
];

test("points: series is optional with one series; negatives and decimals are fine", () => {
  const { rows, issues, fixtureIds } = parsePointsSheet(
    [
      { fixture_id: 1, player_id: "P1", points: 54.5 },
      { fixture_id: 1, player_id: "P2", points: -3 },
    ],
    { fixtures, players, now: new Date("2026-10-12T00:00:00Z") },
  );
  assert.deepEqual(errors(issues), []);
  assert.deepEqual(rows.map((r) => [r.fixtureId, r.playerId, r.points]), [[1, 100, 54.5], [1, 101, -3]]);
  assert.deepEqual(fixtureIds, [1]);
});

test("points: unknown ids, a player from neither team, duplicates and non-numbers are errors", () => {
  const { rows, issues } = parsePointsSheet(
    [
      { fixture_id: 1, player_id: "P3", points: 10, __row: 2 },
      { fixture_id: 9, player_id: "P1", points: 10, __row: 3 },
      { fixture_id: 1, player_id: "P9", points: 10, __row: 4 },
      { fixture_id: 1, player_id: "P1", points: "ten", __row: 5 },
      { fixture_id: 1, player_id: "P1", points: 10, __row: 6 },
      { fixture_id: 1, player_id: "P1", points: 12, __row: 7 },
    ],
    { fixtures, players, now: new Date("2026-10-12T00:00:00Z") },
  );
  assert.deepEqual(rows.map((r) => r.row), [6]);
  assert.deepEqual(errors(issues), [
    "Russell doesn't play for either team in IPL 2026 fixture 1",
    "No fixture 9 in IPL 2026",
    "No player with player_id P9",
    'points "ten" isn\'t a number',
    "Rohit already has points for this fixture on row 6",
  ]);
});

test("points: future, abandoned and implausible values warn but don't block", () => {
  const { rows, issues } = parsePointsSheet([{ fixture_id: 2, player_id: "P3", points: 900 }], {
    fixtures,
    players,
    now: new Date("2026-10-12T00:00:00Z"),
  });
  assert.equal(rows.length, 1);
  assert.equal(errors(issues).length, 0);
  assert.equal(issues.filter((i) => i.level === "warning").length, 3);
});

test("points: with several series, the series column is required", () => {
  const two = [...fixtures, { ...fixtures[0], id: 3, series: "Other Cup" }];
  const { issues } = parsePointsSheet([{ fixture_id: 1, player_id: "P1", points: 1 }], { fixtures: two, players, now: new Date() });
  assert.deepEqual(errors(issues), ["series is blank, and the tournament has more than one series"]);
});
