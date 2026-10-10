import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, joinRequests, leagueAdmins, leagues, teamMembers, teams } from "@/lib/db";
import { getRequestPerson } from "@/lib/accounts";
import { jsonNoStore } from "@/lib/http/no-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/leagues — everything the My Leagues hub and the league switcher list:
 * - `teams`: leagues the person plays in, with their team there;
 * - `adminOf`: leagues they administer (superadmins: `allLeagues: true`, they manage everything);
 * - `pending`: join requests still waiting for an admin.
 */
export async function GET(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [memberships, adminRows, pendingRows] = await Promise.all([
    db
      .select({
        leagueId: leagues.id,
        slug: leagues.slug,
        leagueName: leagues.name,
        format: leagues.format,
        season: leagues.season,
        isActive: leagues.isActive,
        teamId: teams.id,
        teamName: teams.name,
        isProfileComplete: teams.isProfileComplete,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .innerJoin(leagues, eq(leagues.id, teamMembers.leagueId))
      .where(eq(teamMembers.userId, user.id))
      .orderBy(asc(leagues.name)),
    user.role === "admin"
      ? db
          .select({ leagueId: leagues.id, slug: leagues.slug, leagueName: leagues.name, format: leagues.format, season: leagues.season })
          .from(leagueAdmins)
          .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId))
          .where(eq(leagueAdmins.userId, user.id))
          .orderBy(asc(leagues.name))
      : Promise.resolve([]),
    db
      .select({ requestId: joinRequests.id, leagueId: leagues.id, slug: leagues.slug, leagueName: leagues.name, createdAt: joinRequests.createdAt })
      .from(joinRequests)
      .innerJoin(leagues, eq(leagues.id, joinRequests.leagueId))
      .where(and(eq(joinRequests.userId, user.id), eq(joinRequests.status, "pending"))),
  ]);

  return jsonNoStore({
    teams: memberships,
    adminOf: adminRows,
    allLeagues: user.role === "superadmin",
    pending: pendingRows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
}
