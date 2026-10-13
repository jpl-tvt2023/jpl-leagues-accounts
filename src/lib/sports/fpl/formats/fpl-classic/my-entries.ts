import { and, eq, inArray } from "drizzle-orm";
import { db, fplClassicEntrants, leagues, userFplTeams } from "@/lib/db";
import { FPL_CLASSIC_FORMAT } from "@/lib/format-palette";

/** A person's place in an FPL Classic league, found through one of their saved FPL teams. */
export interface MyClassicEntry {
  leagueId: string;
  slug: string;
  leagueName: string;
  sport: string;
  season: string;
  isActive: boolean;
  entrantId: string;
  fplEntryId: number;
  entryName: string;
  totalPoints: number;
  lastRank: number | null;
}

/**
 * FPL Classic leagues have no accounts: an entrant is an FPL team, not a person. A person "is in"
 * one when an FPL team they saved on their account (`user_fpl_teams`) is an active entrant there.
 * With two saved teams in the same league, the one with more points stands for them.
 */
export async function myClassicEntries(userId: string): Promise<MyClassicEntry[]> {
  const saved = await db
    .select({ fplEntryId: userFplTeams.fplEntryId })
    .from(userFplTeams)
    .where(eq(userFplTeams.userId, userId));
  // Saved as text, stored by the Classic sync as an integer.
  const ids = [...new Set(saved.map((s) => Number(s.fplEntryId)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      leagueId: leagues.id,
      slug: leagues.slug,
      leagueName: leagues.name,
      sport: leagues.sport,
      season: leagues.season,
      isActive: leagues.isActive,
      entrantId: fplClassicEntrants.id,
      fplEntryId: fplClassicEntrants.fplEntryId,
      entryName: fplClassicEntrants.entryName,
      totalPoints: fplClassicEntrants.totalPoints,
      lastRank: fplClassicEntrants.lastRank,
    })
    .from(fplClassicEntrants)
    .innerJoin(leagues, eq(leagues.id, fplClassicEntrants.leagueId))
    .where(
      and(
        inArray(fplClassicEntrants.fplEntryId, ids),
        eq(fplClassicEntrants.isActive, true),
        eq(leagues.format, FPL_CLASSIC_FORMAT),
      ),
    );

  const best = new Map<string, MyClassicEntry>();
  for (const row of rows) {
    const current = best.get(row.leagueId);
    if (!current || row.totalPoints > current.totalPoints) best.set(row.leagueId, row);
  }
  return [...best.values()].sort((a, b) => a.leagueName.localeCompare(b.leagueName));
}
