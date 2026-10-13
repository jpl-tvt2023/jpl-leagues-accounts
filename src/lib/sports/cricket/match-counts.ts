/**
 * How many matches a player is expected to play, as managers see it. The Players sheet holds the
 * group-stage count; in a league tournament (the IPL) the playoffs are added once their fixtures are
 * uploaded, counted from the player's team. Until then the count reads "14 + playoffs*". Pure.
 */

export type PlayoffState = "none" | "pending" | "uploaded";

/** "none" for a window of series; for a league tournament, whether its playoff fixtures are in yet. */
export function playoffState(tournamentKind: string, playoffFixtures: number): PlayoffState {
  if (tournamentKind !== "league") return "none";
  return playoffFixtures > 0 ? "uploaded" : "pending";
}

/** "14", "14 + playoffs*" (not uploaded yet) or "14 + 2" (their team's playoff matches). */
export function t20MatchesLabel(groupMatches: number, state: PlayoffState, teamPlayoffMatches: number): string {
  if (state === "pending") return `${groupMatches} + playoffs*`;
  if (state === "uploaded" && teamPlayoffMatches > 0) return `${groupMatches} + ${teamPlayoffMatches}`;
  return String(groupMatches);
}

export const PLAYOFFS_FOOTNOTE = "* plus playoff matches if their team qualifies";

/** Playoff fixtures per real team id. */
export function playoffMatchesByTeam(fixtures: Array<{ stage: string; teamAId: number; teamBId: number }>): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of fixtures) {
    if (f.stage !== "playoff") continue;
    for (const t of [f.teamAId, f.teamBId]) out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}
