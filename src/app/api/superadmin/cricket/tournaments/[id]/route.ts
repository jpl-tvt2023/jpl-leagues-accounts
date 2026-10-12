/**
 * GET    /api/superadmin/cricket/tournaments/[id] — the tournament, its counts and linked leagues.
 * PATCH  /api/superadmin/cricket/tournaments/[id] — { name?, season?, status? }.
 * DELETE /api/superadmin/cricket/tournaments/[id] — with all its data; refused while leagues play it.
 */

import { NextRequest, NextResponse } from "next/server";
import { deleteTournament, getTournamentSummary, updateTournament } from "@/lib/sports/cricket/tournaments";
import { errorResponse, requireSuperAdmin } from "@/lib/sports/cricket/http";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const tournament = await getTournamentSummary(id);
    if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    return NextResponse.json({ tournament });
  } catch (err) {
    return errorResponse(err, "cricket tournament GET");
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; season?: unknown; status?: unknown };
    const tournament = await updateTournament(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      season: typeof body.season === "string" ? body.season : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
    });
    return NextResponse.json({ tournament });
  } catch (err) {
    return errorResponse(err, "cricket tournament PATCH");
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteTournament(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return errorResponse(err, "cricket tournament DELETE");
  }
}
