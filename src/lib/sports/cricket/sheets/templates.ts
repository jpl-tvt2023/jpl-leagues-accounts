/** Example rows for the downloadable templates (IPL-flavoured). Pure. */

import { POINTS_MATCH_COLUMNS, SHEET_COLUMNS } from "./columns";
import type { SheetKind } from "./types";

// Rows follow SHEET_COLUMNS order. Uploads name players and teams the way a scorer types them;
// player_id is optional (left blank here on purpose).
const EXAMPLES: Record<SheetKind, Array<Array<string | number>>> = {
  teams: [
    ["MI", "Mumbai Indians", 1500],
    ["CSK", "Chennai Super Kings", 1500],
  ],
  players: [
    ["", "Rohit Sharma", "MI", "BAT", 1600, "N", "", "", 14],
    ["", "Jasprit Bumrah", "MI", "BOWL", 1800, "N", "", "", 14],
    ["", "MS Dhoni", "Chennai Super Kings", "WK", 400, "N", "", "", 14],
  ],
  fixtures: [
    ["IPL 2026", 1, "T20", "CSK", "MI", "2026-03-28 19:30", "", "Chennai"],
    ["IPL 2026", 2, "T20", "MI", "CSK", "2026-04-05 15:30", "", "Mumbai"],
  ],
  // A grid: team and player, then one column per fixture id (the Fixtures example's 1 and 2).
  points: [
    ["MI", "Rohit Sharma", 54, 12],
    ["MI", "Jasprit Bumrah", 33.5, ""],
    ["CSK", "MS Dhoni", -2, 8],
  ],
};

/** The points sheet's key columns, as the template writes them: team_code, player_name. */
const POINTS_KEY_HEADERS = SHEET_COLUMNS.points.filter((c) => c.required).map((c) => c.header);

export const SHEET_TITLES: Record<SheetKind, string> = {
  teams: "Teams",
  players: "Players",
  fixtures: "Fixtures",
  points: "Points",
};

/** Playoff template options: the next fixture id per series (after its group stage). */
export interface PlayoffTemplate {
  nextIds: Record<string, number>;
}

/** A points template for a tournament: every player, and the series' fixture ids 1 … n. */
export interface PointsTemplate {
  fixtureIds: number[];
  players: Array<{ team: string; name: string }>;
}

/** Header row + example rows, as an array of arrays for SheetJS's aoa_to_sheet. */
export function templateRows(kind: SheetKind, playoffs?: PlayoffTemplate, points?: PointsTemplate): Array<Array<string | number>> {
  if (kind === "points" && points) {
    return [[...POINTS_KEY_HEADERS, ...points.fixtureIds], ...points.players.map((p) => [p.team, p.name, ...points.fixtureIds.map(() => "")])];
  }
  if (kind === "points") return [[...POINTS_KEY_HEADERS, 1, 2], ...EXAMPLES.points];
  const header = SHEET_COLUMNS[kind].map((c) => c.header);
  if (kind === "fixtures" && playoffs) {
    const [series, next] = Object.entries(playoffs.nextIds)[0] ?? ["IPL 2026", 71];
    // The first id shows where the playoffs start; the blank one is numbered automatically.
    return [
      header,
      [series, next, "T20", "GT", "CSK", "2026-05-26 19:30", "", "Ahmedabad"],
      [series, "", "T20", "LSG", "MI", "2026-05-27 19:30", "", "Chennai"],
    ];
  }
  return [header, ...EXAMPLES[kind]];
}

/** One row per column explaining it, for the template's Notes sheet. */
export function templateNotes(kind: SheetKind, playoffs?: PlayoffTemplate): Array<Array<string>> {
  const rows = [
    ["column", "required", "what goes in it"],
    ...SHEET_COLUMNS[kind].map((c) => [c.header, c.required ? "yes" : "no", c.help]),
    ...(kind === "points" ? [[POINTS_MATCH_COLUMNS.header, "yes", POINTS_MATCH_COLUMNS.help]] : []),
  ];
  if (kind === "fixtures" && playoffs) {
    const next = Object.entries(playoffs.nextIds).map(([s, n]) => `${s}: from ${n}`).join("; ");
    rows.push([], ["Playoffs", "", `Playoff fixture ids continue from the group stage (${next || "upload the group stage first"}). Leave fixture_id blank to number them in order.`]);
  }
  return rows;
}
