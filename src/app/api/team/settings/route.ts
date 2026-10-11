import { NextRequest, NextResponse } from "next/server";
import { db, teams, players } from "@/lib/db";
import { eq, and, sql, asc } from "drizzle-orm";
import { leagueFromRequest, resolveTeamActor, teamActorDenied } from "@/lib/team-actor";

/**
 * GET /api/team/settings?league=<slug>
 * Returns the signed-in person's team name and read-only player info in that league.
 */
export async function GET(request: NextRequest) {
  try {
    const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
    if (!actor) return teamActorDenied(denial, { unauthenticated: "Unauthorized" });
    const teamId = actor.teamId;

    const teamList = await db.select().from(teams).where(eq(teams.id, teamId));
    const team = teamList[0];

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const teamPlayers = await db
      .select({ name: players.name, fplId: players.fplId })
      .from(players)
      .where(eq(players.teamId, teamId))
      .orderBy(asc(players.createdAt), asc(players.id));

    return NextResponse.json({
      teamName: team.name,
      players: teamPlayers,
    });
  } catch (error) {
    console.error("Team settings GET error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

/**
 * PATCH /api/team/settings?league=<slug> { teamName }
 * Self-service rename of the signed-in person's team in that league. Never touches players or
 * isProfileComplete (those are out of scope for this route by design). The team key is internal
 * and can't be changed here.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { actor, denial } = await resolveTeamActor(request, { league: leagueFromRequest(request) });
    if (!actor) return teamActorDenied(denial, { unauthenticated: "Unauthorized" });
    const teamId = actor.teamId;

    const body = await request.json();
    const { teamLoginId, teamName } = body;

    if (typeof teamLoginId === "string" && teamLoginId.trim() !== "") {
      return NextResponse.json({ error: "The team key can't be changed." }, { status: 400 });
    }
    if (typeof teamName !== "string" || teamName.trim() === "") {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const teamList = await db.select().from(teams).where(eq(teams.id, teamId));
    const team = teamList[0];

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const trimmedTeamName = teamName.trim();

    const existingName = await db
      .select()
      .from(teams)
      .where(
        and(eq(teams.leagueId, team.leagueId), sql`LOWER(REPLACE(${teams.name}, ' ', '')) = LOWER(REPLACE(${trimmedTeamName}, ' ', ''))`)
      );
    if (existingName.length > 0 && existingName[0].id !== teamId) {
      return NextResponse.json({ error: "Team name is already taken in this league" }, { status: 400 });
    }

    await db.update(teams).set({ name: trimmedTeamName, updatedAt: new Date() }).where(eq(teams.id, teamId));

    return NextResponse.json({ success: true, message: "Settings updated successfully" });
  } catch (error) {
    console.error("Team settings PATCH error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
