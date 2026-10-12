import { and, eq } from "drizzle-orm";
import { auctionOwnership, auctionScores, db, gameweeks, teams } from "@/lib/db";
import { calculateFMV } from "./economy";
import { computeAuctionStandings } from "./standings";

/**
 * Reads everything the auction table needs for one league and ranks it. The standings page and
 * the home page both come through here, so a team's rank is the same on both.
 *
 * Returns the raw inputs too: the standings route reuses them for its tooltips.
 */
export async function loadAuctionStandings(leagueId: string) {
  const [leagueTeams, scores, gwRows, allOwnership] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name, teamLoginId: teams.teamLoginId, purse: teams.purse })
      .from(teams)
      .where(and(eq(teams.leagueId, leagueId), eq(teams.isGhost, false))),
    db.select().from(auctionScores).where(eq(auctionScores.leagueId, leagueId)),
    db.select({ id: gameweeks.id, number: gameweeks.number }).from(gameweeks).where(eq(gameweeks.leagueId, leagueId)),
    db
      .select()
      .from(auctionOwnership)
      .where(and(eq(auctionOwnership.leagueId, leagueId), eq(auctionOwnership.status, "active"))),
  ]);
  const gwNumbers = new Map(gwRows.map((g) => [g.id, g.number]));

  // Squad value (sum of FMV) per team — the second tiebreaker.
  const squadValues = new Map<string, number>();
  for (const owned of allOwnership) {
    // FMV uses RAW points only (per locked spec — synergy never compounds into FMV).
    // Legacy breakdown rows carry `points` (no `rawPoints`); we tolerate both shapes.
    const playerTotalPoints = scores
      .filter((s) => s.teamId === owned.teamId)
      .reduce((sum, s) => {
        const breakdown = JSON.parse(s.playerBreakdown || "[]") as Array<{ elementId: number; points?: number; rawPoints?: number }>;
        const match = breakdown.find((p) => p.elementId === owned.fplElementId);
        const playerPts = match?.rawPoints ?? match?.points ?? 0;
        return sum + playerPts;
      }, 0);
    const fmv = calculateFMV(owned.purchasePrice, playerTotalPoints);
    squadValues.set(owned.teamId, (squadValues.get(owned.teamId) ?? 0) + fmv);
  }

  const standings = computeAuctionStandings(leagueTeams, scores, gwNumbers, squadValues);
  return { leagueTeams, scores, gwNumbers, standings };
}
