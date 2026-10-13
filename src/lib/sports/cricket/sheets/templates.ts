/** Example rows for the downloadable templates (IPL-flavoured). Pure. */

import { SHEET_COLUMNS } from "./columns";
import type { SheetKind } from "./types";

const EXAMPLES: Record<SheetKind, Array<Array<string | number>>> = {
  teams: [
    ["MI", "Mumbai Indians", 1500],
    ["CSK", "Chennai Super Kings", 1500],
  ],
  players: [
    ["P001", "Rohit Sharma", "MI", "BAT", 1600, "N", "", "", 14],
    ["P002", "Jasprit Bumrah", "MI", "BOWL", 1800, "N", "", "", 14],
    ["P003", "MS Dhoni", "CSK", "WK", 400, "N", "", "", 14],
  ],
  fixtures: [
    ["IPL 2026", 1, "T20", "CSK", "MI", "2026-03-28 19:30", "", "Chennai"],
    ["IPL 2026", 2, "T20", "MI", "CSK", "2026-04-05 15:30", "", "Mumbai"],
  ],
  points: [
    ["IPL 2026", 1, "P001", 54],
    ["IPL 2026", 1, "P002", 33.5],
    ["IPL 2026", 1, "P003", -2],
  ],
};

export const SHEET_TITLES: Record<SheetKind, string> = {
  teams: "Teams",
  players: "Players",
  fixtures: "Fixtures",
  points: "Points",
};

/** Header row + example rows, as an array of arrays for SheetJS's aoa_to_sheet. */
export function templateRows(kind: SheetKind): Array<Array<string | number>> {
  return [SHEET_COLUMNS[kind].map((c) => c.header), ...EXAMPLES[kind]];
}

/** One row per column explaining it, for the template's Notes sheet. */
export function templateNotes(kind: SheetKind): Array<Array<string>> {
  return [
    ["column", "required", "what goes in it"],
    ...SHEET_COLUMNS[kind].map((c) => [c.header, c.required ? "yes" : "no", c.help]),
  ];
}
