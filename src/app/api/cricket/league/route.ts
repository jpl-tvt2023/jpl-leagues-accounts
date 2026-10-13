/**
 * GET /api/cricket/league?league=<slug>
 *
 * Everything a cricket league's pages show — settings, teams, standings, the player pool and
 * fixtures — in one cached payload, plus `myTeamId` for the signed-in viewer. Public, like every
 * league's standings.
 */

import { NextRequest, NextResponse } from "next/server";
import { getLeagueView } from "@/lib/sports/cricket/league";
import { getRequestSession, sessionTeamIdInLeague } from "@/lib/team-actor";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  try {
    const ref = request.nextUrl.searchParams.get("league");
    if (!ref) return NextResponse.json({ error: "league is required" }, { status: 400 });
    const view = await getLeagueView(ref);
    if (!view) return NextResponse.json({ error: "Cricket league not found" }, { status: 404 });
    const myTeamId = await sessionTeamIdInLeague(await getRequestSession(request), view.league.id);
    return NextResponse.json({ ...view, myTeamId }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket league GET");
  }
}
