/**
 * GET /api/cricket/fixture?league=<slug>&fixtureId=<id>
 *
 * One fixture's uploaded points, each player with the manager who owns them in this league and
 * whether they earn that manager's franchise boost.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, cricketPlayerPoints, cricketPlayers, cricketFixtures } from "@/lib/db";
import { getLeagueView } from "@/lib/sports/cricket/league";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  try {
    const ref = request.nextUrl.searchParams.get("league");
    const fixtureId = Number(request.nextUrl.searchParams.get("fixtureId"));
    if (!ref || !Number.isInteger(fixtureId)) return NextResponse.json({ error: "league and fixtureId are required" }, { status: 400 });
    const view = await getLeagueView(ref);
    if (!view) return NextResponse.json({ error: "Cricket league not found" }, { status: 404 });
    const [fixture] = await db
      .select({ id: cricketFixtures.id })
      .from(cricketFixtures)
      .where(and(eq(cricketFixtures.id, fixtureId), eq(cricketFixtures.tournamentId, view.tournament.id)))
      .limit(1);
    if (!fixture) return NextResponse.json({ error: "Fixture not found" }, { status: 404 });

    const rows = await db
      .select({ playerId: cricketPlayerPoints.playerId, points: cricketPlayerPoints.points, name: cricketPlayers.name, teamId: cricketPlayers.teamId, role: cricketPlayers.role })
      .from(cricketPlayerPoints)
      .innerJoin(cricketPlayers, eq(cricketPlayers.id, cricketPlayerPoints.playerId))
      .where(eq(cricketPlayerPoints.fixtureId, fixtureId))
      .orderBy(desc(cricketPlayerPoints.points));

    const ownerByPlayer = new Map(view.players.filter((p) => p.ownerTeamId).map((p) => [p.id, p.ownerTeamId!]));
    const franchiseByTeam = new Map(view.teams.filter((t) => t.franchise).map((t) => [t.id, t.franchise!.id]));
    const factor = view.config.franchiseAuctionEnabled ? view.config.franchiseBoostPercent / 100 : 0;
    return NextResponse.json({
      rows: rows.map((r) => {
        const owner = ownerByPlayer.get(r.playerId) ?? null;
        const boosted = !!owner && factor !== 0 && franchiseByTeam.get(owner) === r.teamId;
        return {
          playerId: r.playerId,
          name: r.name,
          teamId: r.teamId,
          role: r.role,
          points: r.points,
          ownerTeamId: owner,
          boosted,
          total: Math.round((boosted ? r.points * (1 + factor) : r.points) * 100) / 100,
        };
      }),
    });
  } catch (err) {
    return errorResponse(err, "cricket fixture GET");
  }
}
