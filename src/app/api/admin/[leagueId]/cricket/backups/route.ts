/**
 * GET  /api/admin/[leagueId]/cricket/backups — stored snapshots, newest first.
 * POST /api/admin/[leagueId]/cricket/backups — take one now ("Take backup now").
 *
 * The player auction's completion also stores one automatically.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { requireCricketLeague } from "@/lib/sports/cricket/admin";
import { listSnapshots, saveSnapshot } from "@/lib/sports/cricket/backup";
import { errorResponse, sessionUserId } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const info = await requireCricketLeague(leagueId);
    return NextResponse.json({ backups: await listSnapshots(info.league.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket backups GET");
  }
}

export async function POST(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const saved = await saveSnapshot(leagueId, "manual", await sessionUserId(request));
    return NextResponse.json({ backup: saved }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "cricket backups POST");
  }
}
