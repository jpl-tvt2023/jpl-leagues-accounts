/**
 * GET /api/cricket/auction/feed?league=<slug>&session=<id?>
 *
 * The auction room's feed: closed lots with their bids, and missed or automatic turns (see
 * lib/sports/cricket/auction/feed.ts). Public, like the room's stream.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadSessionFeed } from "@/lib/sports/cricket/auction/feed";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  try {
    const league = request.nextUrl.searchParams.get("league");
    if (!league) return NextResponse.json({ error: "league is required" }, { status: 400 });
    const feed = await loadSessionFeed(league, request.nextUrl.searchParams.get("session"));
    if (!feed) return NextResponse.json({ error: "Cricket league not found" }, { status: 404 });
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket auction feed");
  }
}
