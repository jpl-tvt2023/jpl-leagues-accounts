/** POST /api/cricket/auction/redeem — { league }: clear one of your penalty slots for the league's price. */

import { NextRequest, NextResponse } from "next/server";
import { redeemPenalty } from "@/lib/sports/cricket/auction/actions";
import { cricketTeamActor } from "@/lib/sports/cricket/auction/request";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { league?: unknown };
    const who = await cricketTeamActor(request, body.league);
    if ("response" in who) return who.response;
    const result = await redeemPenalty(who.leagueId, who.teamId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "cricket redeem");
  }
}
