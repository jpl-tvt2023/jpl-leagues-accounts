/** Shared request plumbing for the cricket auction's team routes. */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db, cricketAuctionSessions, type CricketAuctionSession } from "@/lib/db";
import { resolveTeamActor, teamActorDenied } from "@/lib/team-actor";
import { loadCricketLeague } from "../league";

/** The caller's team in the cricket league `league` (slug or id), or the response to send instead. */
export async function cricketTeamActor(
  request: NextRequest,
  league: unknown,
): Promise<{ teamId: string; leagueId: string } | { response: NextResponse }> {
  if (typeof league !== "string" || !league) return { response: NextResponse.json({ error: "league is required" }, { status: 400 }) };
  const info = await loadCricketLeague(league);
  if (!info) return { response: NextResponse.json({ error: "Cricket league not found" }, { status: 404 }) };
  const { actor, denial } = await resolveTeamActor(request, { league: info.league.id });
  if (!actor) return { response: teamActorDenied(denial, { forbidden: "You're not on a team in this league" }) };
  return { teamId: actor.teamId, leagueId: info.league.id };
}

/** The league's running (active or paused) auction session, if any. */
export async function runningSession(leagueId: string): Promise<CricketAuctionSession | null> {
  const [row] = await db
    .select()
    .from(cricketAuctionSessions)
    .where(and(eq(cricketAuctionSessions.leagueId, leagueId), or(eq(cricketAuctionSessions.status, "active"), eq(cricketAuctionSessions.status, "paused"))))
    .limit(1);
  return row ?? null;
}
