import { NextRequest, NextResponse } from "next/server";
import { db, teams } from "@/lib/db";
import { eq } from "drizzle-orm";
import { isSuperAdmin } from "@/lib/privilege";
import { getRequestSession, sessionTeamIdInLeague } from "@/lib/team-actor";
import { buildTeamLedger, buildAllTeamsSummary } from "@/lib/sports/fpl/formats/auction/finance";
import { fetchClubOwnershipMap } from "@/lib/sports/fpl/teams/rename-rows";
import { refuseUnlessFplAuction } from "@/lib/sports/route-guards";

/**
 * GET /api/auction/finance
 *
 *   ?teamId=xxx                       → single team ledger (team owner or admin)
 *   ?leagueId=xxx&allTeams=true       → all teams' summaries (admin only)
 */
export async function GET(request: NextRequest) {
  const session = await getRequestSession(request);
  const admin = (await isSuperAdmin(request));

  if (!session && !admin) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const teamId = request.nextUrl.searchParams.get("teamId");
  const leagueIdParam = request.nextUrl.searchParams.get("leagueId");
  const allTeams = request.nextUrl.searchParams.get("allTeams") === "true";

  if (allTeams) {
    if (!admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    if (!leagueIdParam) {
      return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
    }
    const notAuction = await refuseUnlessFplAuction(leagueIdParam);
    if (notAuction) return notAuction;
    const summaries = await buildAllTeamsSummary(leagueIdParam);
    // PL Club Auction rename + ownedClub for tier-chip rendering.
    const clubByTeamId = await fetchClubOwnershipMap(leagueIdParam);
    const loginRows = await db.select({ id: teams.id, teamLoginId: teams.teamLoginId }).from(teams).where(eq(teams.leagueId, leagueIdParam));
    const loginByTeam = new Map(loginRows.map((t) => [t.id, t.teamLoginId]));
    const renamed = summaries.map((s) => {
      const ownedClub = clubByTeamId.get(s.teamId) ?? null;
      return { ...s, teamName: ownedClub?.plTeamName ?? s.teamName, teamLoginId: loginByTeam.get(s.teamId) ?? null, ownedClub };
    });
    return NextResponse.json({ leagueId: leagueIdParam, teams: renamed });
  }

  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const teamRow = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (teamRow.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const notAuction = await refuseUnlessFplAuction(teamRow[0].leagueId);
  if (notAuction) return notAuction;

  // Any team in the same league (any member) may view a ledger; admins may too.
  if (!admin && session && session.type !== "admin") {
    if (!(await sessionTeamIdInLeague(session, teamRow[0].leagueId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const ledger = await buildTeamLedger(teamRow[0].leagueId, teamId);
  if (!ledger) {
    return NextResponse.json({ error: "Ledger unavailable" }, { status: 404 });
  }

  // Override `teamName` with the owned-club name if this team bought one.
  const clubByTeamId = await fetchClubOwnershipMap(teamRow[0].leagueId);
  const ownedClub = clubByTeamId.get(teamId) ?? null;
  const renamedLedger = ownedClub
    ? { ...ledger, teamName: ownedClub.plTeamName, teamLoginId: teamRow[0].teamLoginId, ownedClub }
    : { ...ledger, teamLoginId: teamRow[0].teamLoginId, ownedClub: null };

  return NextResponse.json(renamedLedger);
}
