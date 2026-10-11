import { and, eq } from "drizzle-orm";
import { db, fixtures, teams } from "@/lib/db";
import { computeCupGroupStandings, type CupGroupStanding } from "./standings";

export interface CupGroupPosition {
  /** 1-based rank among the group's human teams (Ghosts never count). */
  rank: number;
  totalTeams: number;
  /** Top two go to the JCL, the rest to the JEL. */
  cupZone: "jcl" | "jel";
  /** The group's human teams, ranked. */
  standings: CupGroupStanding[];
}

/**
 * A team's place in its JPL Cup group. Shared by the team dashboard and the home page so the two
 * always agree on where a team stands.
 */
export async function cupGroupPosition(teamId: string, groupId: string): Promise<CupGroupPosition> {
  const [groupTeams, groupFixtures] = await Promise.all([
    db.select({ id: teams.id, name: teams.name, isGhost: teams.isGhost }).from(teams).where(eq(teams.groupId, groupId)),
    db.query.fixtures.findMany({
      where: and(eq(fixtures.groupId, groupId), eq(fixtures.competitionType, "cup-group")),
      with: { result: true },
    }),
  ]);
  const results = groupFixtures
    .filter((f) => f.result)
    .map((f) => ({
      fixtureId: f.id,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      homeScore: f.result!.homeScore,
      awayScore: f.result!.awayScore,
      homeMatchPoints: f.result!.homeMatchPoints,
      awayMatchPoints: f.result!.awayMatchPoints,
    }));
  const standings = computeCupGroupStandings(
    groupTeams.map((t) => ({ id: t.id, name: t.name, isGhost: t.isGhost ?? false })),
    results,
  ).filter((s) => !s.isGhost);
  const idx = standings.findIndex((s) => s.teamId === teamId);
  const rank = idx >= 0 ? idx + 1 : standings.length;
  return { rank, totalTeams: standings.length, cupZone: rank <= 2 ? "jcl" : "jel", standings };
}
