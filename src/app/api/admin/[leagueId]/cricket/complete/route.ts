/**
 * POST /api/admin/[leagueId]/cricket/complete — { complete: boolean }
 *
 * Marks the season complete (the champion shows) or reopens it. A season also completes on its own
 * once every match that isn't abandoned has points.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { setLeagueComplete } from "@/lib/sports/cricket/admin";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function POST(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const body = (await request.json().catch(() => ({}))) as { complete?: unknown };
    if (typeof body.complete !== "boolean") return NextResponse.json({ error: "complete must be true or false" }, { status: 400 });
    await setLeagueComplete(leagueId, body.complete);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, "cricket complete POST");
  }
}
