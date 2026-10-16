/**
 * Points sheet: a grid of fantasy points, one row per player and one column per match. Pure.
 *
 *   team_code | player_name  | 1  | 2  | 3 | …
 *   MI        | Rohit Sharma | 54 |    | 12
 *   CSK       | MS Dhoni     |    | -2 |
 *
 * Each row's player is identified by its team and name (player_id only for teammates who share a
 * name), so rows can come in any order. A column headed by a whole number is that fixture of the
 * series being uploaded; a blank cell means the player didn't play. Any other column (Adjustment,
 * Total, notes) is ignored with a warning.
 *
 * The same sheet is uploaded again after every game, so a commit is an upsert (planPoints): new
 * cells are added, changed ones updated (and listed for the superadmin to confirm), and nothing is
 * deleted — a saved score whose cell is now blank, or whose player has no row, is kept and reported.
 */

import { cellText, mapSheet, seriesKey } from "./columns";
import { fixtureKey } from "./fixtures";
import { PlayerLookup, type TeamLookup } from "./names";
import { error, rowNumber, warning, type RawRow, type SheetChange, type SheetIssue } from "./types";
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

export interface ParsedPointsSheet {
  rows: PointsRow[];
  issues: SheetIssue[];
  /** Fixtures with at least one value in the sheet. */
  fixtureIds: number[];
  /** Fixtures with a column in the sheet (empty or not). */
  columnFixtureIds: number[];
  /** Each player the sheet has a row for, and that row. */
  playerRows: Map<number, number>;
  /** "fixtureId:playerId" of every filled cell, valid or not. */
  filledCells: Set<string>;
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

const cellKey = (fixtureId: number, playerId: number) => `${fixtureId}:${playerId}`;

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
): ParsedPointsSheet {
  const none = (issues: SheetIssue[]): ParsedPointsSheet => ({ rows: [], issues, fixtureIds: [], columnFixtureIds: [], playerRows: new Map(), filledCells: new Set() });
  if (raws.length === 0) return none([error(0, "The sheet has no rows")]);
  const { rows: mapped, missing, unknown } = mapSheet("points", raws);
  if (missing.length) return none(missing.map((h) => error(0, `Missing column "${h}" — the first two columns are team_code and player_name`, h)));

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
  const filledCells = new Set<string>();
  mapped.forEach(({ row: raw, values }, i) => {
    const row = rowNumber(raw, i);
    const teamText = cellText(values.team);
    const name = cellText(values.player);
    const code = cellText(values.playerCode);
    const cells = matchColumns.filter((c) => cellText(raw[c.header]) !== "");
    const fail = (message: string, column: string) => issues.push(error(row, message, column));
    if (!name && !code) {
      if (cells.length) fail("player_name is blank", "player_name");
      return; // a blank row
    }
    // A row that can't be matched to a player only blocks the upload when it holds points: the sheet
    // may list players before they've played.
    const unmatched = (message: string, column: string) =>
      issues.push(cells.length ? error(row, message, column) : warning(row, `${message}; skipped (no points)`, column));

    // The player: by team and name, or by player_id for teammates who share a name.
    if (!teamText) {
      unmatched("team_code is blank", "team_code");
      return;
    }
    const teamCode = ctx.teams.resolve(teamText);
    const teamId = teamCode ? ctx.teamIdByCode.get(teamCode) : undefined;
    if (teamId === undefined) {
      unmatched(ctx.teams.unknownMessage(teamText), "team_code");
      return;
    }
    let player: PointsPlayer | undefined;
    if (code) {
      player = lookup.code(code);
      if (!player) {
        unmatched(`No player with player_id ${code}`, "player_id");
        return;
      }
      if (player.teamId !== teamId) {
        unmatched(`${player.name} (${code}) plays for ${teamLabel(player.teamId)}, not ${teamLabel(teamId)}`, "player_id");
        return;
      }
    } else {
      const found = lookup.resolve(teamId, name, teamLabel);
      if ("error" in found) {
        unmatched(found.error, "player_name");
        return;
      }
      player = found.player;
    }
    const earlier = rowOfPlayer.get(player.id);
    if (earlier !== undefined) {
      unmatched(`${player.name} (${teamLabel(teamId)}) is already on row ${earlier}`, "player_name");
      return;
    }
    rowOfPlayer.set(player.id, row);

    for (const col of cells) {
      const fixture = fixtureOf.get(col.header);
      if (!fixture) continue; // reported once for the column
      filledCells.add(cellKey(fixture.id, player.id));
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
  return {
    rows,
    issues,
    fixtureIds: [...new Set(rows.map((r) => r.fixtureId))],
    columnFixtureIds: [...fixtureOf.values()].map((f) => f.id),
    playerRows: rowOfPlayer,
    filledCells,
  };
}

export interface StoredPoint {
  fixtureId: number;
  playerId: number;
  points: number;
}

export interface PointsPlan {
  inserts: PointsRow[];
  updates: Array<PointsRow & { was: number }>;
  unchanged: number;
  /** Fixtures that get new or changed points. */
  changedFixtureIds: number[];
  /** Saved scores this upload changes, for the superadmin to confirm. */
  changes: SheetChange[];
  issues: SheetIssue[];
}

/**
 * The upsert a parsed sheet makes against the saved points. Every change to a saved score is listed
 * (after a game only the new match's column should change), and saved scores the sheet no longer
 * shows are kept and reported, never deleted (the fixture's Clear points removes them).
 */
export function planPoints(
  sheet: Pick<ParsedPointsSheet, "rows" | "columnFixtureIds" | "playerRows" | "filledCells">,
  stored: StoredPoint[],
  label: { fixture: (id: number) => string; fixtureNo: (id: number) => string; player: (id: number) => string },
): PointsPlan {
  const storedBy = new Map(stored.map((p) => [cellKey(p.fixtureId, p.playerId), p.points]));
  const plan: PointsPlan = { inserts: [], updates: [], unchanged: 0, changedFixtureIds: [], changes: [], issues: [] };
  const changed = new Set<number>();
  for (const r of sheet.rows) {
    const was = storedBy.get(cellKey(r.fixtureId, r.playerId));
    if (was === undefined) {
      plan.inserts.push(r);
      changed.add(r.fixtureId);
    } else if (Math.abs(was - r.points) > 1e-9) {
      plan.updates.push({ ...r, was });
      changed.add(r.fixtureId);
      plan.changes.push({ row: r.row, item: label.player(r.playerId), change: `${label.fixture(r.fixtureId)}: ${was} → ${r.points}` });
    } else {
      plan.unchanged++;
    }
  }
  // Saved scores in this sheet's columns that the sheet no longer shows.
  const columns = new Set(sheet.columnFixtureIds);
  const missingPlayers = new Map<number, number[]>();
  for (const p of stored) {
    if (!columns.has(p.fixtureId) || sheet.filledCells.has(cellKey(p.fixtureId, p.playerId))) continue;
    const row = sheet.playerRows.get(p.playerId);
    if (row === undefined) {
      missingPlayers.set(p.playerId, [...(missingPlayers.get(p.playerId) ?? []), p.fixtureId]);
      continue;
    }
    plan.issues.push(
      warning(row, `${label.player(p.playerId)}: ${label.fixture(p.fixtureId)} has ${p.points} saved but the cell is blank — kept (Clear points on the fixture removes it)`, label.fixtureNo(p.fixtureId)),
    );
  }
  for (const [playerId, fixtureIds] of missingPlayers) {
    const list = fixtureIds.map(label.fixtureNo).join(", ");
    plan.issues.push(warning(0, `${label.player(playerId)} has saved points (fixture ${list}) but no matching row in the sheet — kept`));
  }
  if (sheet.rows.length && !plan.inserts.length && !plan.updates.length) plan.issues.push(warning(0, "Nothing new — every score in the sheet is already uploaded"));
  plan.changedFixtureIds = [...changed];
  return plan;
}
