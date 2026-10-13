/**
 * PATCH /api/superadmin/cricket/tournaments/[id]/fixtures/[fixtureId]
 * Body: { action: "abandon" | "reinstate" | "clear-points" }
 *
 * Abandoned fixtures don't count toward a league's "every fixture scored" completion. Clearing a
 * fixture's points puts it back to scheduled (so its teams can change in a fixtures re-upload).
 */

import { NextRequest, NextResponse } from "next/server";
import { updateFixtureStatus } from "@/lib/sports/cricket/tournaments";
import { errorResponse, requireSuperAdmin } from "@/lib/sports/cricket/http";

type Params = { params: Promise<{ id: string; fixtureId: string }> };

const ACTIONS = ["abandon", "reinstate", "clear-points"] as const;

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireSuperAdmin(request);
  if (denied) return denied;
  try {
    const { id, fixtureId } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = ACTIONS.find((a) => a === body.action);
    if (!action) return NextResponse.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
    const fid = Number(fixtureId);
    if (!Number.isInteger(fid)) return NextResponse.json({ error: "Bad fixture id" }, { status: 400 });
    await updateFixtureStatus(id, fid, action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "cricket fixture PATCH");
  }
}
