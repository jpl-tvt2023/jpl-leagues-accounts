/**
 * GET   /api/admin/[leagueId]/cricket/config — the cricket league's settings for its console.
 * PATCH /api/admin/[leagueId]/cricket/config — update them (see lib/sports/cricket/admin.ts for
 *       what locks once the auction has started).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { auctionSessionCount, requireCricketLeague, settingsOf, updateCricketSettings } from "@/lib/sports/cricket/admin";
import { getTournamentSummary } from "@/lib/sports/cricket/tournaments";
import { errorResponse } from "@/lib/sports/cricket/http";

async function payload(leagueId: string) {
  const info = await requireCricketLeague(leagueId);
  const [sessions, tournament] = await Promise.all([auctionSessionCount(info.league.id), getTournamentSummary(info.tournament.id)]);
  return {
    league: info.league,
    tournament: tournament && {
      id: tournament.id,
      name: tournament.name,
      kind: tournament.kind,
      status: tournament.status,
      teams: tournament.teams,
      players: tournament.players,
      fixtures: tournament.fixtures,
      fixturesScored: tournament.fixturesScored,
    },
    settings: settingsOf(info),
    completedAt: info.config.completedAt,
    settingsLocked: sessions > 0,
  };
}

export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await payload(leagueId));
  } catch (err) {
    return errorResponse(err, "cricket config GET");
  }
}

export async function PATCH(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = await request.json().catch(() => null);
    await updateCricketSettings(leagueId, body);
    return NextResponse.json(await payload(leagueId));
  } catch (err) {
    return errorResponse(err, "cricket config PATCH");
  }
}
