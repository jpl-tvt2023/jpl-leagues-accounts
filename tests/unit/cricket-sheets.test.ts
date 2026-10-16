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
import { parsePointsSheet, type PointsFixture } from "../../src/lib/sports/cricket/sheets/points";
import { blockingIssues } from "../../src/lib/sports/cricket/sheets/types";

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
// A grid row as SheetJS reads it: keyed by header, the players column headed the way scorers write it.
const P = "Match no\nPlayers";
const grid = (rows: Array<Record<string, unknown>>) => rows.map((r, i) => ({ __row: i + 2, ...r }));

test("points: a grid of players down and fixture ids across; blank cells and blank rows are skipped", () => {
  const { rows, issues, fixtureIds } = parsePointsSheet(
    grid([
      { [P]: "Rohit", 1: 54.5, 2: "" },
      { [P]: "  dhoni. ", 1: -3, 2: "" },
      { [P]: "", 1: "", 2: "" },
    ]),
    pointsCtx,
  );
  assert.deepEqual(errors(issues), []);
  assert.deepEqual(rows.map((r) => [r.row, r.fixtureId, r.playerId, r.points]), [[2, 1, 100, 54.5], [3, 1, 101, -3]]);
  assert.deepEqual(fixtureIds, [1]);
});

test("points: columns that aren't fixture ids (Adjustment, Total, notes) are ignored with one warning", () => {
  const { rows, issues } = parsePointsSheet(
    grid([{ [P]: "Rohit", 1: 10, Adjustment: 99, Total: 109, __EMPTY: "kane - 4", __EMPTY_1: "" }]),
    pointsCtx,
  );
  assert.deepEqual(errors(issues), []);
  assert.deepEqual(rows.map((r) => r.points), [10]);
  assert.deepEqual(
    issues.filter((i) => i.level === "warning").map((i) => i.message),
    ['Ignored, not match numbers: "Adjustment", "Total", 1 column(s) with no header'],
  );
});

test("points: wrong match for the team, missing fixtures, non-numbers, repeats and unknown names are errors", () => {
  const { rows, issues } = parsePointsSheet(
    grid([
      { [P]: "Rohit", 1: 10, 9: "", 75: "" },
      { [P]: "Russell", 1: 5, 9: "", 75: "" },
      { [P]: "Dhoni", 1: "kane - 4", 9: 3, 75: "" },
      { [P]: "Rohit", 1: 12, 9: "", 75: "" },
      { [P]: "Rohitt", 1: 1, 9: "", 75: "" },
      { [P]: "Nobody", 1: "", 9: "", 75: "" },
      { [P]: "", 1: 4, 9: "", 75: "" },
    ]),
    pointsCtx,
  );
  assert.deepEqual(rows.map((r) => r.row), [2]);
  assert.deepEqual(errors(issues), [
    "No fixture 9 in IPL 2026", // column 75 has no fixture either, but it's empty
    "Russell (KKR) didn't play IPL 2026 fixture 1 (MI v CSK)",
    `"kane - 4" isn't a number`,
    "Rohit is already on row 2",
    `No player called "Rohitt" in the Players sheet — did you mean Rohit?`,
    "player is blank",
  ]);
  // A name we don't know, with no points yet, only warns.
  assert.ok(issues.some((i) => i.level === "warning" && /No player called "Nobody".*skipped \(no points\)/.test(i.message)));
});

test("points: two players sharing a name need a team (or player_id) column", () => {
  const twins = [...players, { id: 103, code: "S1", name: "Sharma", teamId: 1 }, { id: 104, code: "S2", name: "Sharma", teamId: 2 }];
  const ctx = { ...pointsCtx, players: twins };
  assert.deepEqual(errors(parsePointsSheet(grid([{ [P]: "Sharma", 1: 7 }]), ctx).issues), [
    `2 players are called "Sharma" (MI, CSK) — add a team column to say which`,
  ]);
  assert.deepEqual(parsePointsSheet(grid([{ [P]: "Sharma", team: "Chennai Super Kings", 1: 7 }]), ctx).rows.map((r) => r.playerId), [104]);
  assert.deepEqual(parsePointsSheet(grid([{ [P]: "", player_id: "S1", 1: 7 }]), ctx).rows.map((r) => r.playerId), [103]);
});

test("points: the players column, at least one match column and some points are required", () => {
  assert.deepEqual(errors(parsePointsSheet(grid([{ Who: "Rohit", 1: 3 }]), pointsCtx).issues), [
    `Missing column "Match no / Players" — the first column lists the players`,
  ]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ Players: "Rohit", Adjustment: 3 }]), pointsCtx).issues), [
    "No match columns — after the players column, the header row should hold fixture ids (1, 2, 3 …)",
  ]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ player: "Rohit", 1: "" }]), pointsCtx).issues), [
    "No points in the sheet — fill in at least one match column",
  ]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ [P]: "Rohit", 1: 3, "1_1": 4 }]), pointsCtx).issues), ["Match 1 has more than one column"]);
});

test("points: future, abandoned and implausible values warn but don't block", () => {
  const { rows, issues } = parsePointsSheet(grid([{ [P]: "Russell", 2: 900 }]), pointsCtx);
  assert.equal(rows.length, 1);
  assert.equal(errors(issues).length, 0);
  assert.equal(issues.filter((i) => i.level === "warning").length, 3);
});

test("points: with several series, the upload names the series the match columns belong to", () => {
  const two = [...fixtures, { ...fixtures[0], id: 3, series: "Other Cup" }];
  const ctx = { ...pointsCtx, fixtures: two };
  assert.deepEqual(errors(parsePointsSheet(grid([{ [P]: "Rohit", 1: 1 }]), ctx).issues), ["This tournament has 2 series — pick the one these points are for"]);
  assert.deepEqual(parsePointsSheet(grid([{ [P]: "Rohit", 1: 1 }]), { ...ctx, series: "other  cup" }).fixtureIds, [3]);
  assert.deepEqual(errors(parsePointsSheet(grid([{ [P]: "Rohit", 1: 1 }]), { ...ctx, series: "Nope" }).issues), [`No series "Nope" in this tournament`]);
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
