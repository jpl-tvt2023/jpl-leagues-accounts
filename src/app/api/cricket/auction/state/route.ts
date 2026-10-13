/**
 * GET /api/cricket/auction/state?league=<slug>
 *
 * The auction room's snapshot (see lib/sports/cricket/auction/snapshot.ts), plus `myTeamId`. Also
 * advances the session's clock once, as a safety net for when no stream is connected.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildAuctionSnapshot } from "@/lib/sports/cricket/auction/snapshot";
import { tick } from "@/lib/sports/cricket/auction/engine";
import { getRequestSession, sessionTeamIdInLeague } from "@/lib/team-actor";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  try {
    const league = request.nextUrl.searchParams.get("league");
    if (!league) return NextResponse.json({ error: "league is required" }, { status: 400 });
    let snap = await buildAuctionSnapshot(league);
    if (!snap) return NextResponse.json({ error: "Cricket league not found" }, { status: 404 });
    if (snap.current?.status === "active") {
      // Moving the clock on is best-effort: if it collides with another request's write, the room
      // still gets its snapshot, and the stream or the next read moves it on (every step is a CAS).
      try {
        await tick(snap.current.sessionId, "rest");
        snap = (await buildAuctionSnapshot(league)) ?? snap;
      } catch (err) {
        console.warn("cricket auction state: tick skipped:", err instanceof Error ? err.message : err);
      }
    }
    const myTeamId = await sessionTeamIdInLeague(await getRequestSession(request), snap.leagueId);
    return NextResponse.json({ ...snap, myTeamId }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket auction state");
  }
}
