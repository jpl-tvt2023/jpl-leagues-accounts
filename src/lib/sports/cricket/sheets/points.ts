/**
 * Points sheet: a grid of fantasy points, one row per player and one column per match. Pure.
 *
 *   Match no / Players | 1  | 2   | 3 | …
 *   Rohit Sharma       | 54 |     | 12
 *   MS Dhoni           |    | -2  |
 *
 * A column headed by a whole number is that fixture of the series being uploaded; a blank cell means
 * the player didn't play. Any other column (Adjustment, Total, notes) is ignored with a warning.
 * Players are named the way a scorer types them; a team or player_id column is only needed when two
 * players share a name.
 *
 * Re-uploading replaces every point of each fixture that has at least one value in the file; empty
 * columns and fixtures not in the file are left alone, so the same sheet can grow match by match.
 */

import { cellText, mapSheet, seriesKey } from "./columns";
import { fixtureKey } from "./fixtures";
import { PlayerLookup, type TeamLookup } from "./names";
import { error, rowNumber, warning, type RawRow, type SheetIssue } from "./types";
import { parseNumber } from "./values";

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

/** SheetJS names a blank header cell "__EMPTY", "__EMPTY_1", … */
const BLANK_HEADER = /^__EMPTY(_\d+)?$/;
/** …and a repeated header "12" as "12_1", "12_2", … */
const MATCH_HEADER = /^\s*(\d+)\s*$/;
const REPEATED_MATCH_HEADER = /^\s*(\d+)\s*_\d+$/;

export function parsePointsSheet(
  raws: RawRow[],
  ctx: {
    fixtures: PointsFixture[];
    players: PointsPlayer[];
    teams: TeamLookup;
    teamIdByCode: Map<string, number>;
    now: Date;
    /** The series the sheet is for; needed when the tournament has more than one. */
    series?: string | null;
  },
): { rows: PointsRow[]; issues: SheetIssue[]; fixtureIds: number[] } {
  const none = (issues: SheetIssue[]) => ({ rows: [], issues, fixtureIds: [] });
  if (raws.length === 0) return none([error(0, "The sheet has no rows")]);
  const { rows: mapped, missing, unknown } = mapSheet("points", raws);
  if (missing.length) return none(missing.map((h) => error(0, `Missing column "${h}" — the first column lists the players`, h)));

  // Which series the match numbers belong to.
  const seriesNames = [...new Map(ctx.fixtures.map((f) => [seriesKey(f.series), f.series])).values()];
  let series: string | null = null;
  if (ctx.series) {
    series = seriesNames.find((s) => seriesKey(s) === seriesKey(ctx.series!)) ?? null;
    if (!series) return none([error(0, `No series "${ctx.series}" in this tournament`)]);
  } else if (seriesNames.length === 1) {
    series = seriesNames[0];
  } else if (seriesNames.length > 1) {
    return none([error(0, `This tournament has ${seriesNames.length} series — pick the one these points are for`)]);
  } else {
    return none([]); // no fixtures yet: the caller says to upload them first
  }

  // Match columns, and the columns that are ignored.
  const issues: SheetIssue[] = [];
  const matchColumns: Array<{ header: string; fixtureNo: number }> = [];
  const ignored: string[] = [];
  let blankHeaders = 0;
  const hasValues = (header: string) => raws.some((r) => cellText(r[header]) !== "");
  for (const header of unknown) {
    const m = header.match(MATCH_HEADER);
    const repeated = header.match(REPEATED_MATCH_HEADER);
    if (m && Number(m[1]) >= 1) matchColumns.push({ header, fixtureNo: Number(m[1]) });
    else if (repeated) issues.push(error(1, `Match ${repeated[1]} has more than one column`, repeated[1]));
    else if (BLANK_HEADER.test(header)) blankHeaders += hasValues(header) ? 1 : 0;
    else ignored.push(header);
  }
  if (ignored.length || blankHeaders) {
    const parts = [...ignored.map((h) => `"${h}"`), ...(blankHeaders ? [`${blankHeaders} column(s) with no header`] : [])];
    issues.push(warning(1, `Ignored, not match numbers: ${parts.join(", ")}`));
  }
  if (matchColumns.length === 0) {
    return none([...issues, error(1, "No match columns — after the players column, the header row should hold fixture ids (1, 2, 3 …)")]);
  }
  matchColumns.sort((a, b) => a.fixtureNo - b.fixtureNo);

  // Each match column's fixture. A column for a fixture that doesn't exist is only a problem if it
  // holds points (an empty column for a later match is fine).
  const fixtureByKey = new Map(ctx.fixtures.map((f) => [fixtureKey(f.series, f.fixtureNo), f]));
  const fixtureOf = new Map<string, PointsFixture>();
  for (const col of matchColumns) {
    const fixture = fixtureByKey.get(fixtureKey(series, col.fixtureNo));
    if (fixture) fixtureOf.set(col.header, fixture);
    else if (hasValues(col.header)) issues.push(error(1, `No fixture ${col.fixtureNo} in ${series}`, col.header));
  }

  const lookup = new PlayerLookup(ctx.players);
  const codeByTeamId = new Map([...ctx.teamIdByCode].map(([code, id]) => [id, code]));
  const teamLabel = (id: number) => codeByTeamId.get(id) ?? "?";

  const rows: PointsRow[] = [];
  const rowOfPlayer = new Map<number, number>();
  const warnedFixtures = new Set<number>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const name = cellText(values.player);
    const code = cellText(values.playerCode);
    const teamText = cellText(values.team);
    const cells = matchColumns.filter((c) => cellText(raw[c.header]) !== "");
    if (!name && !code) {
      if (cells.length) issues.push(error(row, "player is blank", "player"));
      return; // a blank row
    }

    // The player: by player_id, else by name (within the team when one is given).
    const fail = (message: string, column: string) => issues.push(error(row, message, column));
    let player: PointsPlayer | undefined;
    let teamId: number | undefined;
    if (teamText) {
      const teamCode = ctx.teams.resolve(teamText);
      teamId = teamCode ? ctx.teamIdByCode.get(teamCode) : undefined;
      if (teamId === undefined) {
        fail(ctx.teams.unknownMessage(teamText), "team");
        return;
      }
    }
    if (code) {
      player = lookup.code(code);
      if (!player) {
        fail(`No player with player_id ${code}`, "player_id");
        return;
      }
      if (teamId !== undefined && player.teamId !== teamId) {
        fail(`${player.name} (${code}) plays for ${teamLabel(player.teamId)}, not ${teamLabel(teamId)}`, "player_id");
        return;
      }
    } else {
      const found = teamId !== undefined ? lookup.resolve(teamId, name, teamLabel) : lookup.resolveAnyTeam(name, teamLabel);
      if ("error" in found) {
        // A name we don't know with no points yet is a warning: the sheet may list players early.
        if ("unknown" in found && found.unknown && cells.length === 0) issues.push(warning(row, `${found.error}; skipped (no points)`, "player"));
        else fail(found.error, "player");
        return;
      }
      player = found.player;
    }
    const earlier = rowOfPlayer.get(player.id);
    if (earlier !== undefined) {
      fail(`${player.name} is already on row ${earlier}`, "player");
      return;
    }
    rowOfPlayer.set(player.id, row);

    for (const col of cells) {
      const fixture = fixtureOf.get(col.header);
      if (!fixture) continue; // reported once for the column
      const text = cellText(raw[col.header]);
      const points = parseNumber(raw[col.header]);
      if (points === null) {
        fail(`"${text}" isn't a number`, col.header);
        continue;
      }
      if (player.teamId !== fixture.teamAId && player.teamId !== fixture.teamBId) {
        fail(`${player.name} (${teamLabel(player.teamId)}) didn't play ${fixture.series} fixture ${fixture.fixtureNo} (${teamLabel(fixture.teamAId)} v ${teamLabel(fixture.teamBId)})`, col.header);
        continue;
      }
      if (!warnedFixtures.has(fixture.id)) {
        warnedFixtures.add(fixture.id);
        if (fixture.startsAt > ctx.now) issues.push(warning(row, `${fixture.series} fixture ${fixture.fixtureNo} hasn't started yet`, col.header));
        if (fixture.status === "abandoned") {
          issues.push(warning(row, `${fixture.series} fixture ${fixture.fixtureNo} is marked abandoned; uploading points marks it completed`, col.header));
        }
      }
      if (Math.abs(points) > IMPLAUSIBLE_POINTS) issues.push(warning(row, `${points} points in one match looks too high — check it`, col.header));
      rows.push({ row, fixtureId: fixture.id, playerId: player.id, points });
    }
  });
  if (rows.length === 0 && !issues.some((x) => x.level === "error")) issues.push(error(0, "No points in the sheet — fill in at least one match column"));
  return { rows, issues, fixtureIds: [...new Set(rows.map((r) => r.fixtureId))] };
}
