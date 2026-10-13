/**
 * GET /api/cricket/auction/wishlist?league=<slug> — your wishlist (player ids, highest priority first).
 * PUT /api/cricket/auction/wishlist — { league, playerIds }: replace it.
 *
 * When your nomination timer runs out, the first player on it you can still buy is nominated for you.
 */

import { NextRequest, NextResponse } from "next/server";
import { getWishlist, setWishlist } from "@/lib/sports/cricket/auction/actions";
import { cricketTeamActor } from "@/lib/sports/cricket/auction/request";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  try {
    const who = await cricketTeamActor(request, request.nextUrl.searchParams.get("league"));
    if ("response" in who) return who.response;
    return NextResponse.json({ playerIds: await getWishlist(who.leagueId, who.teamId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket wishlist GET");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { league?: unknown; playerIds?: unknown };
    const who = await cricketTeamActor(request, body.league);
    if ("response" in who) return who.response;
    if (!Array.isArray(body.playerIds) || body.playerIds.some((id) => typeof id !== "number")) {
      return NextResponse.json({ error: "playerIds must be a list of player ids" }, { status: 400 });
    }
    const result = await setWishlist(who.leagueId, who.teamId, body.playerIds as number[]);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ playerIds: await getWishlist(who.leagueId, who.teamId) });
  } catch (err) {
    return errorResponse(err, "cricket wishlist PUT");
  }
}
