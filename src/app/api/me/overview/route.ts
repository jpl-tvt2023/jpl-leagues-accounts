import { NextResponse, type NextRequest } from "next/server";
import { getRequestPerson } from "@/lib/accounts";
import { jsonNoStore } from "@/lib/http/no-store";
import { loadOverview } from "@/lib/dashboard/league-summary";
import { LAST_LEAGUE_COOKIE, lastLeagueSlug } from "@/lib/last-league";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/overview — the signed-in home page: every league the person plays in, runs, or has
 * an FPL team entered in (with a compact status each), the summary tiles, their to-dos, and the
 * other active leagues, grouped by sport. See src/lib/dashboard/overview.ts for the shape.
 */
export async function GET(request: NextRequest) {
  const user = await getRequestPerson(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const overview = await loadOverview(user, {
    lastLeagueSlug: lastLeagueSlug(request.cookies.get(LAST_LEAGUE_COOKIE)?.value),
  });
  return jsonNoStore(overview);
}
