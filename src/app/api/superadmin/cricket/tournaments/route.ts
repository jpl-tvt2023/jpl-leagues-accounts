/**
 * GET  /api/superadmin/cricket/tournaments — every cricket tournament with its data counts.
 * POST /api/superadmin/cricket/tournaments — create one: { name, season, kind: "league" | "window" }.
 */

import { NextRequest, NextResponse } from "next/server";
import { createTournament, listTournaments } from "@/lib/sports/cricket/tournaments";
import { errorResponse, requireSuperAdmin } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ tournaments: await listTournaments() });
  } catch (err) {
    return errorResponse(err, "cricket tournaments GET");
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; season?: unknown; kind?: unknown };
    const tournament = await createTournament({
      name: String(body.name ?? ""),
      season: String(body.season ?? ""),
      kind: String(body.kind ?? "league"),
    });
    return NextResponse.json({ tournament }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "cricket tournaments POST");
  }
}
