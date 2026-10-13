/**
 * POST /api/cricket/auction/nominate — { league, playerId } in the player auction, or
 * { league, cricketTeamId } in the franchise auction. Only on your turn; you open the bidding at the
 * player's base price (or the franchise's current opening price).
 */

import { NextRequest, NextResponse } from "next/server";
import { nominateLot } from "@/lib/sports/cricket/auction/engine";
import { cricketTeamActor, runningSession } from "@/lib/sports/cricket/auction/request";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { league?: unknown; playerId?: unknown; cricketTeamId?: unknown };
    const who = await cricketTeamActor(request, body.league);
    if ("response" in who) return who.response;
    const auctionSession = await runningSession(who.leagueId);
    if (!auctionSession) return NextResponse.json({ error: "The auction isn't live" }, { status: 400 });
    const target =
      typeof body.playerId === "number" ? { playerId: body.playerId } : typeof body.cricketTeamId === "number" ? { cricketTeamId: body.cricketTeamId } : null;
    if (!target) return NextResponse.json({ error: "Say what you're nominating" }, { status: 400 });
    const result = await nominateLot(auctionSession.id, who.teamId, target);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "cricket nominate");
  }
}
