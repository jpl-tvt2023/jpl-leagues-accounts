/**
 * Cricket tournament upload sheets (src/lib/sports/cricket/sheets/*): column aliases, IST times, row
 * validation, and the full-list / per-fixture replace plans.
 *
 * Run with: npm run test:unit
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapSheet } from "../../src/lib/sports/cricket/sheets/columns";
import { formatIst, parseClock, parseIstDateTime } from "../../src/lib/sports/cricket/sheets/ist";
import { parseTeamsSheet, planTeams } from "../../src/lib/sports/cricket/sheets/teams";
import { assignPlayerCodes, parsePlayersSheet, parseRole, planPlayers, type ExistingPlayer, type PlayerRow } from "../../src/lib/sports/cricket/sheets/players";
import { TeamLookup, editDistance, normalizeName, slugifyName } from "../../src/lib/sports/cricket/sheets/names";
import { parseFixturesSheet, parseMatchFormat, planFixtures, type ExistingFixture } from "../../src/lib/sports/cricket/sheets/fixtures";
import { parsePointsSheet, planPoints, type PointsFixture } from "../../src/lib/sports/cricket/sheets/points";
import { templateRows } from "../../src/lib/sports/cricket/sheets/templates";
import { blockingIssues, fieldChanges } from "../../src/lib/sports/cricket/sheets/types";

const errors = (issues: { level: string; message: string }[]) => issues.filter((i) => i.level === "error").map((i) => i.message);
const lookup = (teams: Array<[string, string?]>) => new TeamLookup(teams.map(([code, name]) => ({ code, name })));

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
  const { issues } = parsePlayersSheet([{ player_id: "P1", name: "A" }], { teams: lookup([["MI"]]) });
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
  // Changes to saved teams are listed for the superadmin to confirm; new ones (KKR) aren't.
  assert.deepEqual(plan.changes, [
    { row: 3, item: "CSK", change: "name: Chennai → Chennai Super Kings · base price: 1500 → 1600" },
    { row: 0, item: "XX (Gone)", change: "removed" },
  ]);
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
  const teams = lookup([["MI", "Mumbai Indians"], ["CSK", "Chennai Super Kings"]]);
  const { rows, issues } = parsePlayersSheet(
    [
      { player_id: "P1", name: "Rohit Sharma", team: "mi", role: "BAT", base_price: 1600, overseas: "", Test: "", ODI: 0, T20: 14, __row: 2 },
      { player_id: "P2", name: "Pat Cummins", team: "chennai super kings", role: "bowler", base_price: "1,800", overseas: "Yes", T20: 14, __row: 3 },
      { player_id: "P3", name: "X", team: "RCB", role: "BAT", base_price: 20, __row: 4 },
      { player_id: "P4", name: "Y", team: "MI", role: "keeper-ish", base_price: 0, overseas: "maybe", T20: -1, __row: 5 },
      { player_id: "P1", name: "rohit sharma", team: "MI", role: "BAT", base_price: 20, __row: 6 },
    ],
    { teams },
  );
  assert.deepEqual(rows.map((r) => r.code), ["P1", "P2"]);
  assert.deepEqual(rows[0], { row: 2, code: "P1", name: "Rohit Sharma", teamCode: "MI", role: "BAT", basePrice: 1600, overseas: false, matchesTest: 0, matchesOdi: 0, matchesT20: 14 });
  assert.equal(rows[1].overseas, true);
  assert.equal(rows[1].basePrice, 1800);
  const errs = errors(issues);
  assert.ok(errs.includes(`Team "RCB" isn't in the Teams sheet`));
  assert.equal(rows[1].teamCode, "CSK"); // a full team name works too
  assert.ok(errs.includes('Role "keeper-ish" isn\'t WK, BAT, AR or BOWL'));
  assert.ok(errs.includes("base_price must be a whole number of lakhs, at least 1"));
  assert.ok(errs.includes('overseas "maybe" should be Y or N'));
  assert.ok(errs.includes("T20 must be a whole number"));
  assert.ok(errs.includes("player_id P1 is already on row 2"));
  assert.equal(issues.filter((i) => i.level === "warning").length, 1); // same name as row 2
});

test("players need the Teams sheet first", () => {
  const { issues } = parsePlayersSheet([{ player_id: "P1", name: "A", team: "MI", role: "BAT", base_price: 20 }], { teams: lookup([]) });
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
  assert.deepEqual(plan.changes, [
    { row: 2, item: "Owned (MI)", change: "team: MI → CSK" },
    { row: 0, item: "Free (MI)", change: "removed" },
  ]);
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
  const teams = lookup([["IND"], ["AUS"], ["ENG"]]);
  const { rows, issues } = parseFixturesSheet(
    [
      { series: "IND v AUS ODIs", fixture_id: 1, format: "ODI", team_a: "IND", team_b: "AUS", start_time_ist: "2026-01-10 13:30", __row: 2 },
      { series: "ENG v IND Tests", fixture_id: 1, format: "Test", team_a: "ENG", team_b: "IND", start_time_ist: "2026-02-01", time: "15:30", __row: 3 },
      { series: "ind v aus  odis", fixture_id: 1, format: "ODI", team_a: "IND", team_b: "AUS", start_time_ist: "2026-01-12 13:30", __row: 4 },
      { series: "IND v AUS ODIs", fixture_id: 2, format: "ODI", team_a: "IND", team_b: "IND", start_time_ist: "soon", __row: 5 },
    ],
    { teams },
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
    { id: 1, series: "IPL 2026", fixtureNo: 1, stage: "group", matchFormat: "T20", teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-28T14:00:00Z"), venue: null, hasPoints: true },
    { id: 2, series: "IPL 2026", fixtureNo: 2, stage: "group", matchFormat: "T20", teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-29T14:00:00Z"), venue: null, hasPoints: true },
    { id: 3, series: "IPL 2026", fixtureNo: 3, stage: "group", matchFormat: "T20", teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-30T14:00:00Z"), venue: null, hasPoints: false },
  ];
  const plan = planFixtures(
    existing,
    [{ row: 2, series: "IPL 2026", fixtureNo: 1, matchFormat: "T20", teamACode: "MI", teamBCode: "KKR", startsAt: new Date("2026-03-28T14:00:00Z"), venue: null }],
    { teamIdByCode: new Map([["MI", 1], ["CSK", 2], ["KKR", 3]]) },
  );
  assert.deepEqual(plan.deletes, [3]);
  assert.equal(plan.updates.length, 0);
  assert.equal(errors(plan.issues).length, 2); // fixture 1 changes teams, fixture 2 disappears
  assert.deepEqual(plan.changes, [{ row: 0, item: "IPL 2026 fixture 3 (MI v CSK)", change: "removed" }]);
});

test("fixtures plan: a changed start time or venue is listed as old → new", () => {
  const existing: ExistingFixture[] = [
    { id: 1, series: "IPL 2026", fixtureNo: 1, stage: "group", matchFormat: "T20", teamAId: 1, teamBId: 2, startsAt: new Date("2026-03-28T14:00:00Z"), venue: null, hasPoints: false },
  ];
  const plan = planFixtures(
    existing,
    [{ row: 2, series: "IPL 2026", fixtureNo: 1, matchFormat: "T20", teamACode: "MI", teamBCode: "CSK", startsAt: new Date("2026-03-28T10:00:00Z"), venue: "Wankhede" }],
    { teamIdByCode: new Map([["MI", 1], ["CSK", 2]]) },
  );
  assert.deepEqual(plan.changes, [{ row: 2, item: "IPL 2026 fixture 1", change: "start: 2026-03-28 19:30 → 2026-03-28 15:30 · venue: (blank) → Wankhede" }]);
});

test("fieldChanges lists only the fields that differ, and shows blanks", () => {
  assert.equal(fieldChanges([["name", "A", "A"], ["base price", 20, 25], ["venue", null, ""]]), "base price: 20 → 25");
  assert.equal(fieldChanges([["venue", "", "Eden"]]), "venue: (blank) → Eden");
  assert.equal(fieldChanges([["name", "A", "A"]]), "");
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
const pointsCtx = {
  fixtures,
  players,
  teams: lookup([["MI", "Mumbai Indians"], ["CSK", "Chennai Super Kings"], ["KKR", "Kolkata Knight Riders"]]),
  teamIdByCode: new Map([["MI", 1], ["CSK", 2], ["KKR", 3]]),
  now: new Date("2026-10-12T00:00:00Z"),
};
// A grid row as SheetJS reads it: keyed by header, with the sheet row number the client adds.
const grid = (rows: Array<Record<string, unknown>>) => rows.map((r, i) => ({ __row: i + 2, ...r }));

test("points: team_code and player_name identify each row, in any order; blank cells and rows are skipped", () => {
  const { rows, issues, fixtureIds } = parsePointsSheet(
    grid([
      { team_code: "Chennai Super Kings", player_name: "  dhoni. ", 1: -3, 2: "" },
      { team_code: "", player_name: "", 1: "", 2: "" },
      { team_code: "MI", player_name: "Rohit", 1: 54.5, 2: "" },
    ]),
    pointsCtx,
  );
  assert.deepEqual(errors(issues), []);
  assert.deepEqual(rows.map((r) => [r.row, r.fixtureId, r.playerId, r.points]), [[2, 1, 101, -3], [4, 1, 100, 54.5]]);
  assert.deepEqual(fixtureIds, [1]);
  // Other spellings of the two key columns work too, e.g. a scorer's "Team" and "Match no / Players".
  const alt = parsePointsSheet(grid([{ Team: "MI", "Match no\nPlayers": "Rohit", 1: 5 }]), pointsCtx);
  assert.deepEqual(alt.rows.map((r) => r.playerId), [100]);
});

test("points: columns that aren't fixture ids (Adjustment, Total, notes) are ignored with one warning", () => {
  const { rows, issues } = parsePointsSheet(
    grid([{ team_code: "MI", player_name: "Rohit", 1: 10, Adjustment: 99, Total: 109, __EMPTY: "kane - 4", __EMPTY_1: "" }]),
    pointsCtx,
  );
  assert.deepEqual(errors(issues), []);
  assert.deepEqual(rows.map((r) => r.points), [10]);
  assert.deepEqual(
    issues.filter((i) => i.level === "warning").map((i) => i.message),
    ['Ignored, not match numbers: "Adjustment", "Total", 1 column(s) with no header'],
  );
});

test("points: wrong match or team, missing fixtures, non-numbers, repeats and unknown names are errors", () => {
  const { rows, issues } = parsePointsSheet(
    grid([
      { team_code: "MI", player_name: "Rohit", 1: 10, 9: "", 75: "" },
      { team_code: "KKR", player_name: "Russell", 1: 5, 9: "", 75: "" },
      { team_code: "CSK", player_name: "Dhoni", 1: "kane - 4", 9: 3, 75: "" },
      { team_code: "MI", player_name: "Rohit", 1: 12, 9: "", 75: "" },
      { team_code: "MI", player_name: "Rohitt", 1: 1, 9: "", 75: "" },
      { team_code: "MI", player_name: "Dhoni", 1: 1, 9: "", 75: "" },
      { team_code: "XYZ", player_name: "Rohit", 1: 1, 9: "", 75: "" },
      { team_code: "", player_name: "Rohit", 1: 1, 9: "", 75: "" },
      { team_code: "MI", player_name: "", 1: 4, 9: "", 75: "" },
      { team_code: "MI", player_name: "Nobody", 1: "", 9: "", 75: "" },
    ]),
    pointsCtx,
  );
  assert.deepEqual(rows.map((r) => r.row), [2]);
  assert.deepEqual(errors(issues), [
    "No fixture 9 in IPL 2026", // column 75 has no fixture either, but it's empty
    "Russell (KKR) didn't play IPL 2026 fixture 1 (MI v CSK)",
    `"kane - 4" isn't a number`,
    "Rohit (MI) is already on row 2",
    `No MI player called "Rohitt" — did you mean Rohit?`,
    "Dhoni plays for CSK, not MI",
    `Team "XYZ" isn't in the Teams sheet`,
    "team_code is blank",
    "player_name is blank",
  ]);
  // A row that can't be matched but has no points yet only warns.
  assert.ok(issues.some((i) => i.level === "warning" && /No MI player called "Nobody".*skipped \(no points\)/.test(i.message)));
});

test("points: namesakes in different teams are told apart by team; teammates need a player_id", () => {
  const ctx = {
    ...pointsCtx,
    players: [...players, { id: 103, code: "S1", name: "Sharma", teamId: 1 }, { id: 104, code: "S2", name: "Sharma", teamId: 2 }, { id: 105, code: "S3", name: "Sharma", teamId: 2 }],
  };
  assert.deepEqual(parsePointsSheet(grid([{ team_code: "MI", player_name: "Sharma", 1: 7 }]), ctx).rows.map((r) => r.playerId), [103]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ team_code: "CSK", player_name: "Sharma", 1: 7 }]), ctx).issues), [
    `2 CSK players are called "Sharma" — give the player_id (S2 or S3)`,
  ]);
  assert.deepEqual(parsePointsSheet(grid([{ team_code: "CSK", player_name: "Sharma", player_id: "S3", 1: 7 }]), ctx).rows.map((r) => r.playerId), [105]);
});

test("points: team_code, player_name, at least one match column and some points are required", () => {
  assert.deepEqual(errors(parsePointsSheet(grid([{ player_name: "Rohit", 1: 3 }]), pointsCtx).issues), [
    `Missing column "team_code" — the first two columns are team_code and player_name`,
  ]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ team_code: "MI", 1: 3 }]), pointsCtx).issues), [
    `Missing column "player_name" — the first two columns are team_code and player_name`,
  ]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ team_code: "MI", player_name: "Rohit", Adjustment: 3 }]), pointsCtx).issues), [
    "No match columns — after the players column, the header row should hold fixture ids (1, 2, 3 …)",
  ]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ team_code: "MI", player_name: "Rohit", 1: "" }]), pointsCtx).issues), [
    "No points in the sheet — fill in at least one match column",
  ]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ team_code: "MI", player_name: "Rohit", 1: 3, "1_1": 4 }]), pointsCtx).issues), [
    "Match 1 has more than one column",
  ]);
});

test("points: future, abandoned and implausible values warn but don't block", () => {
  const { rows, issues } = parsePointsSheet(grid([{ team_code: "KKR", player_name: "Russell", 2: 900 }]), pointsCtx);
  assert.equal(rows.length, 1);
  assert.equal(errors(issues).length, 0);
  assert.equal(issues.filter((i) => i.level === "warning").length, 3);
});

test("points: with several series, the upload names the series the match columns belong to", () => {
  const two = [...fixtures, { ...fixtures[0], id: 3, series: "Other Cup" }];
  const ctx = { ...pointsCtx, fixtures: two };
  const row = grid([{ team_code: "MI", player_name: "Rohit", 1: 1 }]);
  assert.deepEqual(errors(parsePointsSheet(row, ctx).issues), ["This tournament has 2 series — pick the one these points are for"]);
  assert.deepEqual(parsePointsSheet(row, { ...ctx, series: "other  cup" }).fixtureIds, [3]);
  assert.deepEqual(errors(parsePointsSheet(row, { ...ctx, series: "Nope" }).issues), [`No series "Nope" in this tournament`]);
});

const pointsLabel = {
  fixture: (id: number) => `IPL 2026 fixture ${id}`,
  fixtureNo: (id: number) => String(id),
  player: (id: number) => ({ 100: "Rohit (MI)", 101: "Dhoni (CSK)", 102: "Russell (KKR)", 103: "Bumrah (MI)" })[id] ?? "?",
};

test("points upsert: new cells are added, changed ones listed, unchanged skipped — nothing is deleted", () => {
  const sheet = {
    rows: [
      { row: 2, fixtureId: 1, playerId: 100, points: 44 }, // was 40
      { row: 3, fixtureId: 1, playerId: 101, points: 10 }, // same
      { row: 4, fixtureId: 2, playerId: 102, points: 7 }, // new
    ],
    columnFixtureIds: [1, 2],
    playerRows: new Map([[100, 2], [101, 3], [102, 4]]),
    filledCells: new Set(["1:100", "1:101", "2:102", "2:101"]), // 2:101 is filled but invalid
  };
  const stored = [
    { fixtureId: 1, playerId: 100, points: 40 },
    { fixtureId: 1, playerId: 101, points: 10 },
    { fixtureId: 2, playerId: 100, points: 5 }, // Rohit's cell for fixture 2 is blank now
    { fixtureId: 2, playerId: 101, points: 3 }, // filled (badly) — reported by the parser, not here
    { fixtureId: 1, playerId: 103, points: 12 }, // Bumrah has no row
    { fixtureId: 9, playerId: 100, points: 50 }, // fixture 9 isn't a column of this sheet
  ];
  const plan = planPoints(sheet, stored, pointsLabel);
  assert.deepEqual(plan.inserts.map((r) => [r.fixtureId, r.playerId, r.points]), [[2, 102, 7]]);
  assert.deepEqual(plan.updates.map((r) => [r.fixtureId, r.playerId, r.was, r.points]), [[1, 100, 40, 44]]);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.changes, [{ row: 2, item: "Rohit (MI)", change: "IPL 2026 fixture 1: 40 → 44" }]);
  assert.deepEqual(plan.changedFixtureIds.sort(), [1, 2]);
  assert.deepEqual(errors(plan.issues), []);
  assert.deepEqual(
    plan.issues.map((i) => i.message),
    [
      "Rohit (MI): IPL 2026 fixture 2 has 5 saved but the cell is blank — kept (Clear points on the fixture removes it)",
      "Bumrah (MI) has saved points (fixture 1) but no matching row in the sheet — kept",
    ],
  );
});

test("points upsert: re-uploading the same sheet changes nothing", () => {
  const sheet = { rows: [{ row: 2, fixtureId: 1, playerId: 100, points: 40 }], columnFixtureIds: [1], playerRows: new Map([[100, 2]]), filledCells: new Set(["1:100"]) };
  const plan = planPoints(sheet, [{ fixtureId: 1, playerId: 100, points: 40 }], pointsLabel);
  assert.equal(plan.inserts.length + plan.updates.length, 0);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.issues.map((i) => i.message), ["Nothing new — every score in the sheet is already uploaded"]);
});

test("points template: team_code, player_name, then the tournament's fixture ids, one row per player", () => {
  const rows = templateRows("points", undefined, { fixtureIds: [1, 2, 3], players: [{ team: "CSK", name: "MS Dhoni" }, { team: "MI", name: "Rohit Sharma" }] });
  assert.deepEqual(rows, [
    ["team_code", "player_name", 1, 2, 3],
    ["CSK", "MS Dhoni", "", "", ""],
    ["MI", "Rohit Sharma", "", "", ""],
  ]);
  assert.deepEqual(templateRows("points")[0], ["team_code", "player_name", 1, 2]);
});

// ─── names ───────────────────────────────────────────────────────────────────

test("names: case, spaces, dots, apostrophes and accents don't matter", () => {
  assert.equal(normalizeName("  Faf du Plessis. "), "faf du plessis");
  assert.equal(normalizeName("R. Ashwin"), normalizeName("R Ashwin"));
  assert.equal(normalizeName(`D'Arcy Short`), "darcy short");
  assert.equal(normalizeName("Hasaranga  Wanindu"), "hasaranga wanindu");
  assert.equal(normalizeName("José"), "jose");
  assert.equal(slugifyName("Virat Kohli"), "virat-kohli");
  assert.equal(editDistance("rohitt", "rohit"), 1);
});

test("teams resolve by code or full name, and unknown ones suggest the closest", () => {
  const teams = lookup([["RCB", "Royal Challengers Bengaluru"], ["MI", "Mumbai Indians"]]);
  assert.equal(teams.resolve("rcb"), "RCB");
  assert.equal(teams.resolve("Royal Challengers  Bengaluru"), "RCB");
  assert.equal(teams.resolve("Chennai"), null);
  assert.match(teams.unknownMessage("Mumbai Indian"), /did you mean MI \(Mumbai Indians\)\?/);
});

// ─── player_id from the name ─────────────────────────────────────────────────

const playerRow = (code: string, name: string, teamCode: string): PlayerRow => ({
  row: 2, code, name, teamCode, role: "BAT", basePrice: 20, overseas: false, matchesTest: 0, matchesOdi: 0, matchesT20: 14,
});

test("blank player_ids: existing players keep theirs (even after a move), new ones get a slug", () => {
  const out = assignPlayerCodes(
    [
      playerRow("", "Virat Kohli", "RCB"),
      playerRow("", "KL Rahul", "DC"), // moved from LSG
      playerRow("", "Rinku Singh", "KKR"), // new
      playerRow("X9", "Explicit", "MI"),
    ],
    [
      { code: "virat", name: "Virat Kohli", teamCode: "RCB" },
      { code: "kl-rahul", name: "K.L. Rahul", teamCode: "LSG" },
    ],
  );
  assert.deepEqual(out.map((r) => r.code), ["virat", "kl-rahul", "rinku-singh", "X9"]);
});

test("blank player_ids: a namesake on another team gets a team suffix, and can't take a teammate's id", () => {
  const out = assignPlayerCodes(
    [playerRow("", "Rahul Sharma", "CSK"), playerRow("", "Rahul Sharma", "MI"), playerRow("", "Arjun", "MI"), playerRow("", "Arjun", "CSK")],
    [{ code: "rahul-sharma", name: "Rahul Sharma", teamCode: "MI" }],
  );
  // The existing MI player keeps his id even though the CSK row comes first.
  assert.deepEqual(out.map((r) => r.code), ["rahul-sharma-csk", "rahul-sharma", "arjun", "arjun-csk"]);
});

test("players: teammates with one name need player_ids", () => {
  const teams = lookup([["MI"]]);
  const base = { team: "MI", role: "BAT", base_price: 20 };
  const blank = parsePlayersSheet([{ name: "A Khan", ...base, __row: 2 }, { name: "a khan", ...base, __row: 3 }], { teams });
  assert.match(errors(blank.issues)[0], /give both a player_id/);
  const coded = parsePlayersSheet([{ player_id: "K1", name: "A Khan", ...base }, { player_id: "K2", name: "A Khan", ...base }], { teams });
  assert.deepEqual(errors(coded.issues), []);
  assert.equal(coded.rows.length, 2);
});

// ─── group stage and playoffs ────────────────────────────────────────────────

const ipl = (no: number, stage: "group" | "playoff", hasPoints = false): ExistingFixture => ({
  id: no, series: "IPL 2026", fixtureNo: no, stage, matchFormat: "T20", teamAId: 1, teamBId: 2,
  startsAt: new Date(Date.UTC(2026, 3, no)), venue: null, hasPoints,
});
const playoffRow = (row: number, fixtureNo: number | null) => ({
  row, series: "IPL 2026", fixtureNo, matchFormat: "T20" as const, teamACode: "MI", teamBCode: "CSK", startsAt: new Date(Date.UTC(2026, 4, 20 + row)), venue: null,
});
const ids = new Map([["MI", 1], ["CSK", 2]]);
const groupStage = Array.from({ length: 70 }, (_, i) => ipl(i + 1, "group", true));

test("playoffs: blank ids continue from the group stage; the group stage is left alone", () => {
  const plan = planFixtures(groupStage, [playoffRow(2, null), playoffRow(3, 72), playoffRow(4, null), playoffRow(5, null)], { teamIdByCode: ids, stage: "playoff" });
  assert.deepEqual(errors(plan.issues), []);
  assert.deepEqual(plan.rows.map((r) => r.fixtureNo), [71, 72, 73, 74]);
  assert.equal(plan.inserts.length, 4);
  assert.deepEqual(plan.deletes, []); // group fixtures aren't this upload's to delete
});

test("playoffs: ids must follow on from the group stage, which must exist", () => {
  const gap = planFixtures(groupStage, [playoffRow(2, 75), playoffRow(3, null)], { teamIdByCode: ids, stage: "playoff" });
  assert.deepEqual(errors(gap.issues), ["IPL 2026's playoffs continue from its group stage: fixture ids 71–72 for these 2 matches (or leave them blank)"]);
  const none = planFixtures([], [playoffRow(2, null)], { teamIdByCode: ids, stage: "playoff" });
  assert.match(errors(none.issues)[0], /Upload IPL 2026's group stage first/);
});

test("stages: each upload replaces only its own stage, and ids can't cross", () => {
  const existing = [ipl(1, "group"), ipl(2, "group"), ipl(3, "playoff"), ipl(4, "playoff")];
  // Re-uploading the playoffs with one match drops the other playoff fixture only.
  const playoffs = planFixtures(existing, [playoffRow(2, null)], { teamIdByCode: ids, stage: "playoff" });
  assert.deepEqual(playoffs.rows.map((r) => r.fixtureNo), [3]);
  assert.deepEqual(playoffs.deletes, [4]);
  // A group-stage row can't take a playoff id.
  const group = planFixtures(existing, [playoffRow(2, 1), playoffRow(3, 3)], { teamIdByCode: ids, stage: "group" });
  assert.match(errors(group.issues)[0], /fixture 3 is already a playoff fixture/);
  assert.deepEqual(group.deletes, [2]);
  // The playoffs survive a group re-upload, with a warning when they no longer follow on.
  const shorter = planFixtures(existing, [playoffRow(2, 1)], { teamIdByCode: ids, stage: "group" });
  assert.match(shorter.issues.find((i) => i.level === "warning")!.message, /playoffs start at 3, but the group stage now ends at 1/);
});
