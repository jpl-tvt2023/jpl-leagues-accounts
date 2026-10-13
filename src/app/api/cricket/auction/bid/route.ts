/**
 * POST /api/cricket/auction/bid — { league, lotId, amount } (lakhs). The amount must be at least
 * the next step on the bid ladder, and leave enough to complete your squad.
 */

import { NextRequest, NextResponse } from "next/server";
import { placeBid } from "@/lib/sports/cricket/auction/engine";
import { cricketTeamActor, runningSession } from "@/lib/sports/cricket/auction/request";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { league?: unknown; lotId?: unknown; amount?: unknown };
    const who = await cricketTeamActor(request, body.league);
    if ("response" in who) return who.response;
    if (typeof body.amount !== "number") return NextResponse.json({ error: "amount is required" }, { status: 400 });
    const auctionSession = await runningSession(who.leagueId);
    if (!auctionSession) return NextResponse.json({ error: "The auction isn't live" }, { status: 400 });
    const result = await placeBid(auctionSession.id, who.teamId, body.amount, typeof body.lotId === "string" ? body.lotId : undefined);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "cricket bid");
  }
}
