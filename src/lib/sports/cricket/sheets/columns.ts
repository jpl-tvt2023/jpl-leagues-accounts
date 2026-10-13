/**
 * Column headers for the four upload sheets, and the other spellings each one accepts.
 *
 * Headers are matched after lower-casing and dropping everything but letters and digits, so
 * "Player ID", "player_id" and "PlayerId" are the same column. When a sheet's layout changes (the
 * points sheet's final layout is still to come), this is the only file to edit.
 */

import type { RawRow, SheetKind } from "./types";

export interface ColumnSpec {
  /** Field name the parsers read. */
  field: string;
  /** Header written into the downloadable template. */
  header: string;
  /** Other accepted headers, already normalised. */
  aliases: string[];
  required: boolean;
  /** One line for the template's notes and the upload card. */
  help: string;
}

export const SHEET_COLUMNS: Record<SheetKind, ColumnSpec[]> = {
  teams: [
    { field: "code", header: "team_code", aliases: ["code", "team", "teamid", "id", "shortname", "short"], required: true, help: "Short code the other sheets use, e.g. MI" },
    { field: "name", header: "name", aliases: ["teamname", "fullname", "franchise"], required: true, help: "Full name, e.g. Mumbai Indians" },
    { field: "basePrice", header: "base_price", aliases: ["price", "base", "franchisebaseprice", "franchiseprice"], required: false, help: "Franchise auction opening price in lakhs (blank = 0)" },
  ],
  players: [
    { field: "code", header: "player_id", aliases: ["id", "playercode", "code"], required: false, help: "Optional. Left blank, it's made from the name (e.g. virat-kohli); a renamed player needs it" },
    { field: "name", header: "name", aliases: ["playername", "player"], required: true, help: "Player name, as the points sheets will spell it" },
    { field: "team", header: "team", aliases: ["teamcode", "teamname", "franchise", "country", "side"], required: true, help: "Team code or full name from the Teams sheet" },
    { field: "role", header: "role", aliases: ["position", "type", "skill"], required: true, help: "WK, BAT, AR or BOWL" },
    { field: "basePrice", header: "base_price", aliases: ["price", "base", "baseprice"], required: true, help: "Auction opening price in lakhs, e.g. 200 = ₹2 Cr" },
    { field: "overseas", header: "overseas", aliases: ["foreign", "os", "isoverseas", "overseasplayer"], required: false, help: "Y or N (blank = N)" },
    { field: "test", header: "Test", aliases: ["tests", "testmatches"], required: false, help: "Expected Test matches in this tournament (blank = 0)" },
    { field: "odi", header: "ODI", aliases: ["odis", "odimatches"], required: false, help: "Expected ODIs (blank = 0)" },
    { field: "t20", header: "T20", aliases: ["t20i", "t20s", "t20is", "t20matches"], required: false, help: "Expected T20s (blank = 0)" },
  ],
  fixtures: [
    { field: "series", header: "series", aliases: ["seriesname", "tournament", "competition"], required: true, help: "Series name; fixture ids restart at 1 in each series" },
    { field: "fixtureNo", header: "fixture_id", aliases: ["fixture", "fixtureno", "fixturenumber", "matchno", "matchnumber", "match", "id"], required: false, help: "1, 2, 3 … within the series. Playoffs continue from the group stage's last; leave them blank to number them automatically" },
    { field: "format", header: "format", aliases: ["matchformat", "matchtype", "type"], required: true, help: "Test, ODI or T20" },
    { field: "teamA", header: "team_a", aliases: ["home", "hometeam", "team1"], required: true, help: "Team code or full name" },
    { field: "teamB", header: "team_b", aliases: ["away", "awayteam", "team2"], required: true, help: "Team code or full name" },
    { field: "start", header: "start_time_ist", aliases: ["start", "starttime", "starts", "startsat", "datetime", "date"], required: true, help: "Indian time, e.g. 2026-04-12 19:30" },
    { field: "time", header: "time", aliases: ["timeist", "starttimeonly"], required: false, help: "Optional: time on its own, if the date column has none" },
    { field: "venue", header: "venue", aliases: ["ground", "stadium", "location"], required: false, help: "Optional" },
  ],
  points: [
    { field: "series", header: "series", aliases: ["seriesname", "tournament", "competition"], required: false, help: "Needed only when the tournament has more than one series" },
    { field: "fixtureNo", header: "fixture_id", aliases: ["fixture", "fixtureno", "fixturenumber", "matchno", "matchnumber", "match"], required: true, help: "Fixture id within its series" },
    { field: "team", header: "team", aliases: ["teamcode", "teamname", "franchise", "country", "side"], required: true, help: "The player's team: code or full name (one of the fixture's two teams)" },
    { field: "player", header: "player", aliases: ["playername", "name"], required: false, help: "Player name as in the Players sheet (needed unless player_id is given)" },
    { field: "playerCode", header: "player_id", aliases: ["playercode", "id", "code"], required: false, help: "Optional: player_id, only needed when two teammates share a name" },
    { field: "points", header: "points", aliases: ["fantasypoints", "pts", "total", "totalpoints", "score"], required: true, help: "Fantasy points for this match (can be negative or decimal)" },
  ],
};

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Normalised header → field, for one sheet. Exact header names win over aliases. */
function headerIndex(kind: SheetKind): Map<string, string> {
  const map = new Map<string, string>();
  for (const spec of SHEET_COLUMNS[kind]) map.set(normalizeHeader(spec.header), spec.field);
  for (const spec of SHEET_COLUMNS[kind]) {
    for (const alias of spec.aliases) if (!map.has(alias)) map.set(alias, spec.field);
  }
  return map;
}

export interface MappedSheet {
  /** One object per row, keyed by field name. */
  rows: Array<{ row: RawRow; values: Record<string, unknown> }>;
  /** Required columns the file doesn't have, by template header. */
  missing: string[];
  /** File headers that match no column (ignored). */
  unknown: string[];
}

/** Map a sheet's raw rows onto field names. */
export function mapSheet(kind: SheetKind, raws: RawRow[]): MappedSheet {
  const index = headerIndex(kind);
  const headers = new Set<string>();
  for (const raw of raws) for (const key of Object.keys(raw)) if (key !== "__row") headers.add(key);

  const fieldByHeader = new Map<string, string>();
  const unknown: string[] = [];
  for (const h of headers) {
    const field = index.get(normalizeHeader(h));
    // First header wins if two map to one field ("Date" and "Start" both → start).
    if (field && ![...fieldByHeader.values()].includes(field)) fieldByHeader.set(h, field);
    else if (!field) unknown.push(h);
  }
  const present = new Set(fieldByHeader.values());
  const missing = SHEET_COLUMNS[kind].filter((c) => c.required && !present.has(c.field)).map((c) => c.header);

  const rows = raws.map((raw) => {
    const values: Record<string, unknown> = {};
    for (const [h, field] of fieldByHeader) values[field] = raw[h];
    return { row: raw, values };
  });
  return { rows, missing, unknown };
}

/** A cell as trimmed text ("" when blank). Numbers are written without float noise. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

/** A team code as stored: trimmed, upper-case. */
export function normalizeTeamCode(value: unknown): string {
  return cellText(value).toUpperCase();
}

/** Series names compare without regard to case or repeated spaces. */
export function seriesKey(series: string): string {
  return series.trim().replace(/\s+/g, " ").toLowerCase();
}
