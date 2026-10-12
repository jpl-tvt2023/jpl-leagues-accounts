import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, fixtures, gameweeks, leagues } from "@/lib/db";
import { resolveViewerInLeague } from "@/lib/viewer";
import { MATCH_CENTER_FORMATS } from "@/lib/sports/fpl/match-center/load";
import { pickDefaultFixture } from "@/lib/sports/fpl/match-center/default-fixture";

export const dynamic = "force-dynamic";

/**
 * /[leagueSlug]/match-center — the Match Center as a nav destination.
 *
 * The Match Center itself lives at /[leagueSlug]/fixtures/[fixtureId] (it opens on a fixture and
 * can then compare any two teams). This picks the fixture: your own match in the gameweek in play,
 * or that gameweek's first match — and sends you there.
 */
export default async function MatchCenterEntry({ params }: { params: Promise<{ leagueSlug: string }> }) {
  const { leagueSlug } = await params;
  const [league] = await db
    .select({ id: leagues.id, format: leagues.format })
    .from(leagues)
    .where(eq(leagues.slug, leagueSlug))
    .limit(1);
  if (!league || !(MATCH_CENTER_FORMATS as readonly string[]).includes(league.format)) notFound();

  const [viewer, rows] = await Promise.all([
    resolveViewerInLeague(league.id, leagueSlug),
    db
      .select({
        id: fixtures.id,
        gw: gameweeks.number,
        deadline: gameweeks.deadline,
        homeTeamId: fixtures.homeTeamId,
        awayTeamId: fixtures.awayTeamId,
        competitionType: fixtures.competitionType,
        isChallenge: fixtures.isChallenge,
      })
      .from(fixtures)
      .innerJoin(gameweeks, eq(gameweeks.id, fixtures.gameweekId))
      .where(eq(gameweeks.leagueId, league.id)),
  ]);

  const pick = pickDefaultFixture(
    rows.map((r) => ({ ...r, isLeagueFixture: !r.competitionType || r.competitionType === "jpl" })),
    new Date(),
    viewer.teamId ?? null,
  );
  // No fixtures yet: the fixtures page explains that better than an empty Match Center.
  redirect(pick ? `/${leagueSlug}/fixtures/${pick.id}` : `/${leagueSlug}/fixtures`);
}
