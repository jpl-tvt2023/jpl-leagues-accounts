/**
 * GET   /api/admin/[leagueId]/cricket/teams — every team with its managers, money and squad, for the
 *       console's Manager Management tab.
 * PATCH /api/admin/[leagueId]/cricket/teams — { teamId, name }: rename a team.
 *
 * A cricket league's teams are made when it is created (their purses live in cricket_team_state);
 * the FPL add/delete team routes refuse cricket leagues.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { listManagerTeams, renameTeam } from "@/lib/sports/cricket/admin";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ teams: await listManagerTeams(leagueId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket teams GET");
  }
}

export async function PATCH(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = (await request.json().catch(() => ({}))) as { teamId?: unknown; name?: unknown };
    if (typeof body.teamId !== "string") return NextResponse.json({ error: "teamId is required" }, { status: 400 });
    await renameTeam(leagueId, body.teamId, body.name);
    return NextResponse.json({ teams: await listManagerTeams(leagueId) });
  } catch (err) {
    return errorResponse(err, "cricket teams PATCH");
  }
}
