/**
 * Points sheet: one fantasy-points total per player per fixture. Pure.
 *
 * Re-uploading replaces every point of each fixture that appears in the file; fixtures not in the
 * file are left alone, so points can go up one match at a time.
 */

import { cellText, mapSheet, seriesKey } from "./columns";
import { fixtureKey } from "./fixtures";
import { error, rowNumber, warning, type RawRow, type SheetIssue } from "./types";
import { parseNumber, parseWhole } from "./values";

export interface PointsRow {
  row: number;
  fixtureId: number;
  playerId: number;
  points: number;
}

export interface PointsFixture {
  id: number;
  series: string;
  fixtureNo: number;
  teamAId: number;
  teamBId: number;
  startsAt: Date;
  status: "scheduled" | "completed" | "abandoned";
}

export interface PointsPlayer {
  id: number;
  code: string;
  name: string;
  teamId: number;
}

/** Points this far from zero for one match are almost certainly a typo, so they're flagged. */
const IMPLAUSIBLE_POINTS = 500;

export function parsePointsSheet(
  raws: RawRow[],
  ctx: { fixtures: PointsFixture[]; players: PointsPlayer[]; now: Date },
): { rows: PointsRow[]; issues: SheetIssue[]; fixtureIds: number[] } {
  const { rows: mapped, missing } = mapSheet("points", raws);
  const issues: SheetIssue[] = missing.map((h) => error(0, `Missing column "${h}"`, h));
  if (missing.length) return { rows: [], issues, fixtureIds: [] };

  const fixtureByKey = new Map(ctx.fixtures.map((f) => [fixtureKey(f.series, f.fixtureNo), f]));
  const playerByCode = new Map(ctx.players.map((p) => [p.code, p]));
  const seriesNames = [...new Set(ctx.fixtures.map((f) => seriesKey(f.series)))];
  const onlySeries = seriesNames.length === 1 ? ctx.fixtures[0].series : null;

  const rows: PointsRow[] = [];
  const seen = new Map<string, number>();
  const futureWarned = new Set<number>();
  const abandonedWarned = new Set<number>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const seriesText = cellText(values.series);
    const series = seriesText || onlySeries;
    const fixtureNo = parseWhole(values.fixtureNo, 1);
    const code = cellText(values.player);
    const points = parseNumber(values.points);
    let ok = true;
    const fail = (message: string, column: string) => {
      ok = false;
      issues.push(error(row, message, column));
    };
    if (!series) fail("series is blank, and the tournament has more than one series", "series");
    if (fixtureNo === undefined) fail("fixture_id is blank", "fixture_id");
    else if (fixtureNo === null) fail("fixture_id must be a whole number from 1", "fixture_id");
    if (!code) fail("player_id is blank", "player_id");
    if (points === null) fail(`points "${cellText(values.points)}" isn't a number`, "points");

    const fixture = series && typeof fixtureNo === "number" ? fixtureByKey.get(fixtureKey(series, fixtureNo)) : undefined;
    if (series && typeof fixtureNo === "number" && !fixture) fail(`No fixture ${fixtureNo} in ${series}`, "fixture_id");
    const player = code ? playerByCode.get(code) : undefined;
    if (code && !player) fail(`No player with player_id ${code}`, "player_id");
    if (fixture && player && player.teamId !== fixture.teamAId && player.teamId !== fixture.teamBId) {
      fail(`${player.name} doesn't play for either team in ${fixture.series} fixture ${fixture.fixtureNo}`, "player_id");
    }
    // Only a row that is otherwise good claims its (fixture, player) slot, so one bad row doesn't
    // turn the corrected row after it into a "duplicate".
    if (ok && fixture && player) {
      const key = `${fixture.id}:${player.id}`;
      if (seen.has(key)) fail(`${player.name} already has points for this fixture on row ${seen.get(key)}`, "player_id");
      else seen.set(key, row);
    }
    if (fixture && fixture.startsAt > ctx.now && !futureWarned.has(fixture.id)) {
      futureWarned.add(fixture.id);
      issues.push(warning(row, `${fixture.series} fixture ${fixture.fixtureNo} hasn't started yet`, "fixture_id"));
    }
    if (fixture && fixture.status === "abandoned" && !abandonedWarned.has(fixture.id)) {
      abandonedWarned.add(fixture.id);
      issues.push(warning(row, `${fixture.series} fixture ${fixture.fixtureNo} is marked abandoned; uploading points marks it completed`, "fixture_id"));
    }
    if (points !== null && Math.abs(points) > IMPLAUSIBLE_POINTS) {
      issues.push(warning(row, `${points} points in one match looks too high — check it`, "points"));
    }
    if (ok && fixture && player && points !== null) rows.push({ row, fixtureId: fixture.id, playerId: player.id, points });
  });
  if (mapped.length === 0) issues.push(error(0, "The sheet has no rows"));
  return { rows, issues, fixtureIds: [...new Set(rows.map((r) => r.fixtureId))] };
}
