/** GET /api/admin/[leagueId]/cricket/finance — where each team's money went (console Finance tab). */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { financeRows } from "@/lib/sports/cricket/admin";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await financeRows(leagueId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket finance GET");
  }
}
