/** Fixtures sheet. Pure. */

import type { CricketMatchFormat } from "@/lib/db/schema-cricket";
import { cellText, mapSheet, normalizeTeamCode, seriesKey } from "./columns";
import { formatIst, parseIstDateTime } from "./ist";
import { error, rowNumber, warning, type RawRow, type SheetIssue } from "./types";
import { parseWhole } from "./values";

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

export function parseFixturesSheet(raws: RawRow[], ctx: { teamCodes: Set<string> }): { rows: FixtureRow[]; issues: SheetIssue[] } {
  const { rows: mapped, missing } = mapSheet("fixtures", raws);
  const issues: SheetIssue[] = missing.map((h) => error(0, `Missing column "${h}"`, h));
  if (missing.length) return { rows: [], issues };
  if (ctx.teamCodes.size === 0) issues.push(error(0, "Upload the Teams sheet first — fixtures need teams"));

  const rows: FixtureRow[] = [];
  const seen = new Map<string, number>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const series = cellText(values.series).replace(/\s+/g, " ");
    const fixtureNo = parseWhole(values.fixtureNo, 1);
    const matchFormat = parseMatchFormat(values.format);
    const teamACode = normalizeTeamCode(values.teamA);
    const teamBCode = normalizeTeamCode(values.teamB);
    const start = parseIstDateTime(values.start, values.time);
    const venue = cellText(values.venue) || null;
    let ok = true;
    const fail = (message: string, column: string) => {
      ok = false;
      issues.push(error(row, message, column));
    };
    if (!series) fail("series is blank", "series");
    if (fixtureNo === undefined) fail("fixture_id is blank", "fixture_id");
    else if (fixtureNo === null) fail("fixture_id must be a whole number from 1", "fixture_id");
    if (!matchFormat) fail(`Format "${cellText(values.format)}" isn't Test, ODI or T20`, "format");
    for (const [code, column] of [
      [teamACode, "team_a"],
      [teamBCode, "team_b"],
    ] as const) {
      if (!code) fail(`${column} is blank`, column);
      else if (ctx.teamCodes.size > 0 && !ctx.teamCodes.has(code)) fail(`Team ${code} isn't in the Teams sheet`, column);
    }
    if (teamACode && teamACode === teamBCode) fail(`${teamACode} can't play itself`, "team_b");
    if (!start) fail(`Can't read the start "${cellText(values.start)}${values.time ? " " + cellText(values.time) : ""}" — use 2026-04-12 19:30 (IST)`, "start_time_ist");
    else if (!start.hasTime) issues.push(warning(row, `No start time given; using ${formatIst(start.date)} IST`, "start_time_ist"));
    if (series && typeof fixtureNo === "number") {
      const key = fixtureKey(series, fixtureNo);
      if (seen.has(key)) fail(`${series} fixture ${fixtureNo} is already on row ${seen.get(key)}`, "fixture_id");
      else seen.set(key, row);
    }
    if (ok && matchFormat && start && typeof fixtureNo === "number") {
      rows.push({ row, series, fixtureNo, matchFormat, teamACode, teamBCode, startsAt: start.date, venue });
    }
  });
  if (mapped.length === 0) issues.push(error(0, "The sheet has no rows"));
  return { rows, issues };
}

export interface ExistingFixture {
  id: number;
  series: string;
  fixtureNo: number;
  matchFormat: CricketMatchFormat;
  teamAId: number;
  teamBId: number;
  startsAt: Date;
  venue: string | null;
  hasPoints: boolean;
}

export type ResolvedFixtureRow = FixtureRow & { teamAId: number; teamBId: number };

export interface FixturesPlan {
  inserts: ResolvedFixtureRow[];
  updates: Array<{ id: number; row: ResolvedFixtureRow }>;
  deletes: number[];
  unchanged: number;
  issues: SheetIssue[];
}

/**
 * The sheet replaces the whole fixture list. A fixture missing from the file is deleted unless it
 * has points; a scored fixture can't change teams (its points belong to the old ones).
 */
export function planFixtures(existing: ExistingFixture[], incoming: FixtureRow[], ctx: { teamIdByCode: Map<string, number> }): FixturesPlan {
  const plan: FixturesPlan = { inserts: [], updates: [], deletes: [], unchanged: 0, issues: [] };
  const byKey = new Map(existing.map((f) => [fixtureKey(f.series, f.fixtureNo), f]));
  const incomingKeys = new Set<string>();

  for (const row of incoming) {
    const teamAId = ctx.teamIdByCode.get(row.teamACode);
    const teamBId = ctx.teamIdByCode.get(row.teamBCode);
    if (teamAId === undefined || teamBId === undefined) continue; // reported by the parser
    const key = fixtureKey(row.series, row.fixtureNo);
    incomingKeys.add(key);
    const next = { ...row, teamAId, teamBId };
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
  }
  for (const fixture of existing) {
    if (incomingKeys.has(fixtureKey(fixture.series, fixture.fixtureNo))) continue;
    if (fixture.hasPoints) {
      plan.issues.push(error(0, `${fixture.series} fixture ${fixture.fixtureNo} is missing from the file but has points; clear them first`));
    } else {
      plan.deletes.push(fixture.id);
    }
  }
  return plan;
}
