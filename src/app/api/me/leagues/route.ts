import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, joinRequests, leagueAdmins, leagues, teamMembers, teams } from "@/lib/db";
import { getRequestPerson } from "@/lib/accounts";
import { jsonNoStore } from "@/lib/http/no-store";
import { needsSetup } from "@/lib/membership";
import { myClassicEntries } from "@/lib/sports/fpl/formats/fpl-classic/my-entries";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/leagues — everything the My Leagues hub and the league switcher list:
 * - `teams`: leagues the person plays in, with their team there (and whether they have setup to do);
 * - `adminOf`: leagues they administer (superadmins: `allLeagues: true`, they manage everything);
 * - `classic`: FPL Classic leagues one of their saved FPL teams is entered in;
 * - `pending`: join requests still waiting for an admin.
 */
export async function GET(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [memberships, adminRows, classic, pendingRows] = await Promise.all([
    db
      .select({
        leagueId: leagues.id,
        slug: leagues.slug,
        leagueName: leagues.name,
        sport: leagues.sport,
        format: leagues.format,
        season: leagues.season,
        isActive: leagues.isActive,
        teamId: teams.id,
        teamName: teams.name,
        isProfileComplete: teams.isProfileComplete,
        playerId: teamMembers.playerId,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .innerJoin(leagues, eq(leagues.id, teamMembers.leagueId))
      .where(eq(teamMembers.userId, user.id))
      .orderBy(asc(leagues.name)),
    user.role === "admin"
      ? db
          .select({ leagueId: leagues.id, slug: leagues.slug, leagueName: leagues.name, sport: leagues.sport, format: leagues.format, season: leagues.season })
          .from(leagueAdmins)
          .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId))
          .where(eq(leagueAdmins.userId, user.id))
          .orderBy(asc(leagues.name))
      : Promise.resolve([]),
    myClassicEntries(user.id),
    db
      .select({ requestId: joinRequests.id, leagueId: leagues.id, slug: leagues.slug, leagueName: leagues.name, createdAt: joinRequests.createdAt })
      .from(joinRequests)
      .innerJoin(leagues, eq(leagues.id, joinRequests.leagueId))
      .where(and(eq(joinRequests.userId, user.id), eq(joinRequests.status, "pending"))),
  ]);

  return jsonNoStore({
    teams: memberships.map(({ playerId, ...t }) => ({ ...t, needsSetup: needsSetup({ ...t, playerId }) })),
    adminOf: adminRows,
    classic: classic.map((c) => ({ leagueId: c.leagueId, slug: c.slug, leagueName: c.leagueName, sport: c.sport, entryName: c.entryName })),
    allLeagues: user.role === "superadmin",
    pending: pendingRows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
}
