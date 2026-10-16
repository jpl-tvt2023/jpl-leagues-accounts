/** Fixtures sheet. Pure. */

import type { CricketFixtureStage, CricketMatchFormat } from "@/lib/db/schema-cricket";
import { cellText, mapSheet, seriesKey } from "./columns";
import { formatIst, parseIstDateTime } from "./ist";
import type { TeamLookup } from "./names";
import { error, fieldChanges, REMOVED, rowNumber, warning, type RawRow, type SheetChange, type SheetIssue } from "./types";
import { parseWhole } from "./values";

export interface ParsedFixtureRow {
  row: number;
  series: string;
  /** null: left blank in a playoffs upload, numbered on from the group stage by planFixtures. */
  fixtureNo: number | null;
  matchFormat: CricketMatchFormat;
  teamACode: string;
  teamBCode: string;
  startsAt: Date;
  venue: string | null;
}

export interface FixtureRow {
  row: number;
  series: string;
  fixtureNo: number;
  matchFormat: CricketMatchFormat;
  teamACode: string;
  teamBCode: string;
  startsAt: Date;
  venue: string | null;
}

/** "Test", "ODI", "T20I", "Twenty20" … → Test / ODI / T20. */
export function parseMatchFormat(value: unknown): CricketMatchFormat | null {
  const t = cellText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t === "test" || t === "tests" || t === "testmatch") return "Test";
  if (t === "odi" || t === "odis" || t === "oneday" || t === "onedayinternational" || t === "50over" || t === "50overs") return "ODI";
  if (t === "t20" || t === "t20i" || t === "t20s" || t === "twenty20" || t === "t20international" || t === "20over" || t === "20overs") return "T20";
  return null;
}

/** The key that identifies a fixture: series (case-insensitive) + fixture number. */
export function fixtureKey(series: string, fixtureNo: number): string {
  return `${seriesKey(series)}#${fixtureNo}`;
}

/**
 * `stage` is what the upload is for. In the group stage every row needs its fixture_id; in the
 * playoffs a blank one is numbered on from the group stage (see planFixtures).
 */
export function parseFixturesSheet(
  raws: RawRow[],
  ctx: { teams: TeamLookup; stage?: CricketFixtureStage },
): { rows: ParsedFixtureRow[]; issues: SheetIssue[] } {
  const stage = ctx.stage ?? "group";
  const { rows: mapped, missing } = mapSheet("fixtures", raws);
  const issues: SheetIssue[] = missing.map((h) => error(0, `Missing column "${h}"`, h));
  if (missing.length) return { rows: [], issues };
  if (ctx.teams.size === 0) issues.push(error(0, "Upload the Teams sheet first — fixtures need teams"));

  const rows: ParsedFixtureRow[] = [];
  const seen = new Map<string, number>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const series = cellText(values.series).replace(/\s+/g, " ");
    const fixtureNo = parseWhole(values.fixtureNo, 1);
    const matchFormat = parseMatchFormat(values.format);
    const teamAText = cellText(values.teamA);
    const teamBText = cellText(values.teamB);
    const teamACode = ctx.teams.resolve(teamAText) ?? "";
    const teamBCode = ctx.teams.resolve(teamBText) ?? "";
    const start = parseIstDateTime(values.start, values.time);
    const venue = cellText(values.venue) || null;
    let ok = true;
    const fail = (message: string, column: string) => {
      ok = false;
      issues.push(error(row, message, column));
    };
    if (!series) fail("series is blank", "series");
    if (fixtureNo === undefined && stage === "group") fail("fixture_id is blank", "fixture_id");
    else if (fixtureNo === null) fail("fixture_id must be a whole number from 1", "fixture_id");
    if (!matchFormat) fail(`Format "${cellText(values.format)}" isn't Test, ODI or T20`, "format");
    for (const [text, code, column] of [
      [teamAText, teamACode, "team_a"],
      [teamBText, teamBCode, "team_b"],
    ] as const) {
      if (!text) fail(`${column} is blank`, column);
      else if (ctx.teams.size > 0 && !code) fail(ctx.teams.unknownMessage(text), column);
    }
    if (teamACode && teamACode === teamBCode) fail(`${teamACode} can't play itself`, "team_b");
    if (!start) fail(`Can't read the start "${cellText(values.start)}${values.time ? " " + cellText(values.time) : ""}" — use 2026-04-12 19:30 (IST)`, "start_time_ist");
    else if (!start.hasTime) issues.push(warning(row, `No start time given; using ${formatIst(start.date)} IST`, "start_time_ist"));
    if (series && typeof fixtureNo === "number") {
      const key = fixtureKey(series, fixtureNo);
      if (seen.has(key)) fail(`${series} fixture ${fixtureNo} is already on row ${seen.get(key)}`, "fixture_id");
      else seen.set(key, row);
    }
    if (ok && matchFormat && start && fixtureNo !== null) {
      rows.push({ row, series, fixtureNo: fixtureNo ?? null, matchFormat, teamACode, teamBCode, startsAt: start.date, venue });
    }
  });
  if (mapped.length === 0) issues.push(error(0, "The sheet has no rows"));
  return { rows, issues };
}

export interface ExistingFixture {
  id: number;
  series: string;
  fixtureNo: number;
  stage: CricketFixtureStage;
  matchFormat: CricketMatchFormat;
  teamAId: number;
  teamBId: number;
  startsAt: Date;
  venue: string | null;
  hasPoints: boolean;
}

export type ResolvedFixtureRow = FixtureRow & { teamAId: number; teamBId: number };

export interface FixturesPlan {
  /** Every incoming row, numbered and with team ids — for the preview and the hash. */
  rows: ResolvedFixtureRow[];
  inserts: ResolvedFixtureRow[];
  updates: Array<{ id: number; row: ResolvedFixtureRow }>;
  deletes: number[];
  unchanged: number;
  /** Saved fixtures this upload changes or removes, for the superadmin to confirm. */
  changes: SheetChange[];
  issues: SheetIssue[];
}

/**
 * The sheet replaces the whole list of one stage — the group stage or the playoffs — leaving the
 * other stage alone. A fixture of that stage missing from the file is deleted unless it has points;
 * a scored fixture can't change teams (its points belong to the old ones).
 *
 * Playoff fixtures continue the numbering of their series' group stage: with group fixtures 1–70,
 * the playoffs are 71, 72 … with no gaps. Blank ids are filled in; a given one must fit.
 */
export function planFixtures(
  existing: ExistingFixture[],
  incoming: ParsedFixtureRow[],
  ctx: { teamIdByCode: Map<string, number>; stage?: CricketFixtureStage },
): FixturesPlan {
  const stage = ctx.stage ?? "group";
  const plan: FixturesPlan = { rows: [], inserts: [], updates: [], deletes: [], unchanged: 0, changes: [], issues: [] };
  const codeByTeamId = new Map([...ctx.teamIdByCode].map(([code, id]) => [id, code]));
  const teams = (a: number, b: number) => `${codeByTeamId.get(a) ?? "?"} v ${codeByTeamId.get(b) ?? "?"}`;
  const mine = existing.filter((f) => f.stage === stage);
  const others = new Map(existing.filter((f) => f.stage !== stage).map((f) => [fixtureKey(f.series, f.fixtureNo), f]));

  // Number the playoffs on from the group stage, series by series.
  const numbered: FixtureRow[] = [];
  if (stage === "playoff") {
    const bySeries = new Map<string, ParsedFixtureRow[]>();
    for (const r of incoming) bySeries.set(seriesKey(r.series), [...(bySeries.get(seriesKey(r.series)) ?? []), r]);
    for (const rows of bySeries.values()) {
      const series = rows[0].series;
      const groupNos = existing.filter((f) => f.stage === "group" && seriesKey(f.series) === seriesKey(series)).map((f) => f.fixtureNo);
      if (groupNos.length === 0) {
        plan.issues.push(error(rows[0].row, `Upload ${series}'s group stage first — playoff fixtures are numbered on from it`, "series"));
        continue;
      }
      const first = Math.max(...groupNos) + 1;
      const last = first + rows.length - 1;
      const given = new Set(rows.flatMap((r) => (r.fixtureNo === null ? [] : [r.fixtureNo])));
      let next = first;
      for (const r of rows) {
        if (r.fixtureNo !== null) {
          if (r.fixtureNo < first || r.fixtureNo > last) {
            plan.issues.push(
              error(r.row, `${series}'s playoffs continue from its group stage: fixture ids ${first}–${last} for these ${rows.length} matches (or leave them blank)`, "fixture_id"),
            );
            continue;
          }
          numbered.push({ ...r, fixtureNo: r.fixtureNo });
          continue;
        }
        while (given.has(next)) next++;
        numbered.push({ ...r, fixtureNo: next });
        next++;
      }
    }
  } else {
    for (const r of incoming) if (r.fixtureNo !== null) numbered.push({ ...r, fixtureNo: r.fixtureNo });
  }

  const byKey = new Map(mine.map((f) => [fixtureKey(f.series, f.fixtureNo), f]));
  const incomingKeys = new Set<string>();
  for (const row of numbered) {
    const teamAId = ctx.teamIdByCode.get(row.teamACode);
    const teamBId = ctx.teamIdByCode.get(row.teamBCode);
    if (teamAId === undefined || teamBId === undefined) continue; // reported by the parser
    const key = fixtureKey(row.series, row.fixtureNo);
    const next = { ...row, teamAId, teamBId };
    plan.rows.push(next);
    const clash = others.get(key);
    if (clash) {
      const what = clash.stage === "playoff" ? "a playoff fixture" : "a group-stage fixture";
      plan.issues.push(error(row.row, `${row.series} fixture ${row.fixtureNo} is already ${what}; ${stage === "group" ? "group-stage" : "playoff"} ids can't reuse it`, "fixture_id"));
      continue;
    }
    incomingKeys.add(key);
    const current = byKey.get(key);
    if (!current) {
      plan.inserts.push(next);
      continue;
    }
    const sameTeams = current.teamAId === teamAId && current.teamBId === teamBId;
    const same =
      sameTeams &&
      current.series === row.series &&
      current.matchFormat === row.matchFormat &&
      current.startsAt.getTime() === row.startsAt.getTime() &&
      (current.venue ?? null) === row.venue;
    if (same) {
      plan.unchanged++;
      continue;
    }
    if (current.hasPoints && !sameTeams) {
      plan.issues.push(error(row.row, `${row.series} fixture ${row.fixtureNo} has points; clear them before changing its teams`, "team_a"));
      continue;
    }
    if (current.hasPoints && current.startsAt.getTime() !== row.startsAt.getTime()) {
      plan.issues.push(warning(row.row, `${row.series} fixture ${row.fixtureNo} already has points; its start time changes`, "start_time_ist"));
    }
    plan.updates.push({ id: current.id, row: next });
    plan.changes.push({
      row: row.row,
      item: `${current.series} fixture ${current.fixtureNo}`,
      change: fieldChanges([
        ["series", current.series, row.series],
        ["teams", teams(current.teamAId, current.teamBId), teams(teamAId, teamBId)],
        ["format", current.matchFormat, row.matchFormat],
        ["start", formatIst(current.startsAt), formatIst(row.startsAt)],
        ["venue", current.venue, row.venue],
      ]),
    });
  }
  for (const fixture of mine) {
    if (incomingKeys.has(fixtureKey(fixture.series, fixture.fixtureNo))) continue;
    if (fixture.hasPoints) {
      plan.issues.push(error(0, `${fixture.series} fixture ${fixture.fixtureNo} is missing from the file but has points; clear them first`));
    } else {
      plan.deletes.push(fixture.id);
      plan.changes.push({ row: 0, item: `${fixture.series} fixture ${fixture.fixtureNo} (${teams(fixture.teamAId, fixture.teamBId)})`, change: REMOVED });
    }
  }

  // Re-uploading the group stage can leave the playoffs no longer following on from it.
  if (stage === "group") {
    for (const series of new Set(numbered.map((r) => r.series))) {
      const groupMax = Math.max(...numbered.filter((r) => seriesKey(r.series) === seriesKey(series)).map((r) => r.fixtureNo));
      const playoffs = [...others.values()].filter((f) => f.stage === "playoff" && seriesKey(f.series) === seriesKey(series)).map((f) => f.fixtureNo);
      if (playoffs.length && Math.min(...playoffs) !== groupMax + 1) {
        plan.issues.push(warning(0, `${series}'s playoffs start at ${Math.min(...playoffs)}, but the group stage now ends at ${groupMax}; re-upload the playoffs`));
      }
    }
  }
  return plan;
}
