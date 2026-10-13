/**
 * GET /api/superadmin/cricket/tournaments/[id]/data?kind=teams|players|fixtures|points|uploads
 *
 * What a tournament currently holds, for the superadmin's tables. `points` needs &fixtureId=.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, cricketTeams, cricketPlayers, cricketFixtures, cricketPlayerPoints, cricketUploads, cricketTournaments, users } from "@/lib/db";
import { playoffMatchesByTeam, playoffState } from "@/lib/sports/cricket/match-counts";
import { formatIst } from "@/lib/sports/cricket/sheets/ist";
import { errorResponse, requireSuperAdmin } from "@/lib/sports/cricket/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const kind = request.nextUrl.searchParams.get("kind");
    const teams = await db.select().from(cricketTeams).where(eq(cricketTeams.tournamentId, id)).orderBy(asc(cricketTeams.code));
    const codeOf = new Map(teams.map((t) => [t.id, t.code]));

    if (kind === "teams") {
      return NextResponse.json({ rows: teams.map((t) => ({ id: t.id, code: t.code, name: t.name, basePrice: t.basePrice })) });
    }
    if (kind === "players") {
      const [players, stages, [t]] = await Promise.all([
        db.select().from(cricketPlayers).where(eq(cricketPlayers.tournamentId, id)).orderBy(asc(cricketPlayers.name)),
        db.select({ stage: cricketFixtures.stage, teamAId: cricketFixtures.teamAId, teamBId: cricketFixtures.teamBId }).from(cricketFixtures).where(eq(cricketFixtures.tournamentId, id)),
        db.select({ kind: cricketTournaments.kind }).from(cricketTournaments).where(eq(cricketTournaments.id, id)).limit(1),
      ]);
      // Group-stage counts come from the sheet; playoff matches from the uploaded playoff fixtures.
      const playoffsByTeam = playoffMatchesByTeam(stages);
      return NextResponse.json({
        playoffs: playoffState(t?.kind ?? "window", stages.filter((s) => s.stage === "playoff").length),
        rows: players.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          team: codeOf.get(p.teamId) ?? "",
          role: p.role,
          basePrice: p.basePrice,
          overseas: p.overseas,
          matchesTest: p.matchesTest,
          matchesOdi: p.matchesOdi,
          matchesT20: p.matchesT20,
          playoffMatches: playoffsByTeam.get(p.teamId) ?? 0,
        })),
      });
    }
    if (kind === "fixtures") {
      const fixtures = await db
        .select({
          id: cricketFixtures.id,
          series: cricketFixtures.series,
          fixtureNo: cricketFixtures.fixtureNo,
          stage: cricketFixtures.stage,
          matchFormat: cricketFixtures.matchFormat,
          teamAId: cricketFixtures.teamAId,
          teamBId: cricketFixtures.teamBId,
          startsAt: cricketFixtures.startsAt,
          venue: cricketFixtures.venue,
          status: cricketFixtures.status,
          pointsUploadedAt: cricketFixtures.pointsUploadedAt,
          pointsRows: sql<number>`(SELECT count(*) FROM ${cricketPlayerPoints} WHERE ${cricketPlayerPoints.fixtureId} = ${cricketFixtures.id})`,
        })
        .from(cricketFixtures)
        .where(eq(cricketFixtures.tournamentId, id))
        .orderBy(asc(cricketFixtures.startsAt), asc(cricketFixtures.series), asc(cricketFixtures.fixtureNo));
      return NextResponse.json({
        rows: fixtures.map((f) => ({
          id: f.id,
          series: f.series,
          fixtureNo: f.fixtureNo,
          stage: f.stage,
          format: f.matchFormat,
          teamA: codeOf.get(f.teamAId) ?? "",
          teamB: codeOf.get(f.teamBId) ?? "",
          startsIst: formatIst(f.startsAt),
          venue: f.venue,
          status: f.status,
          pointsRows: Number(f.pointsRows),
          pointsUploadedAt: f.pointsUploadedAt,
        })),
      });
    }
    if (kind === "points") {
      const fixtureId = Number(request.nextUrl.searchParams.get("fixtureId"));
      if (!Number.isInteger(fixtureId)) return NextResponse.json({ error: "fixtureId is required" }, { status: 400 });
      const rows = await db
        .select({ code: cricketPlayers.code, name: cricketPlayers.name, teamId: cricketPlayers.teamId, points: cricketPlayerPoints.points })
        .from(cricketPlayerPoints)
        .innerJoin(cricketPlayers, eq(cricketPlayers.id, cricketPlayerPoints.playerId))
        .where(and(eq(cricketPlayerPoints.tournamentId, id), eq(cricketPlayerPoints.fixtureId, fixtureId)))
        .orderBy(desc(cricketPlayerPoints.points));
      return NextResponse.json({ rows: rows.map((r) => ({ code: r.code, name: r.name, team: codeOf.get(r.teamId) ?? "", points: r.points })) });
    }
    if (kind === "uploads") {
      const rows = await db
        .select({
          id: cricketUploads.id,
          kind: cricketUploads.kind,
          fileName: cricketUploads.fileName,
          rowCount: cricketUploads.rowCount,
          summary: cricketUploads.summary,
          createdAt: cricketUploads.createdAt,
          by: users.email,
        })
        .from(cricketUploads)
        .leftJoin(users, eq(users.id, cricketUploads.uploadedBy))
        .where(eq(cricketUploads.tournamentId, id))
        .orderBy(desc(cricketUploads.createdAt))
        .limit(50);
      return NextResponse.json({ rows: rows.map((r) => ({ ...r, summary: JSON.parse(r.summary) })) });
    }
    return NextResponse.json({ error: "kind must be teams, players, fixtures, points or uploads" }, { status: 400 });
  } catch (err) {
    return errorResponse(err, "cricket tournament data");
  }
}
