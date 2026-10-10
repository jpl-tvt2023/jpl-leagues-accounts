import { NextResponse, type NextRequest } from "next/server";
import { resolveViewer } from "@/lib/viewer";
import { LAST_LEAGUE_COOKIE, lastLeagueSlug } from "@/lib/last-league";

export const dynamic = "force-dynamic";

/**
 * The installed app's `start_url` (see `src/app/manifest.ts`).
 *
 * Tapping the home-screen icon should land a signed-in user on their own dashboard, not on the
 * public league list — so this resolves the session and redirects. A person (who may play in
 * several leagues) goes to the league they used last. Signed-out visitors (and FPL Classic
 * viewers, who have no accounts) go to the league list.
 */
export async function GET(request: NextRequest) {
  const viewer = await resolveViewer();
  const last = lastLeagueSlug(request.cookies.get(LAST_LEAGUE_COOKIE)?.value);
  const target = !viewer.authenticated
    ? "/"
    : viewer.type !== "team" && last
      ? `/${last}/dashboard`
      : viewer.dashboardHref;
  return NextResponse.redirect(new URL(target, request.url), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
