import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { LAST_LEAGUE_COOKIE, lastLeagueSlug } from "@/lib/last-league";

/**
 * /dashboard — kept as a stable entry point (old links, bookmarks, the account menu).
 *
 * A person can be on teams in several leagues, so dashboards live at /[leagueSlug]/dashboard;
 * this sends them to the league they used last (or their home page / admin dashboard).
 */
export default async function DashboardPage() {
  const viewer = await resolveViewer();
  if (!viewer.authenticated) redirect("/signin?next=/dashboard");
  const last = lastLeagueSlug((await cookies()).get(LAST_LEAGUE_COOKIE)?.value);
  redirect(last ? `/${last}/dashboard` : viewer.dashboardHref);
}
