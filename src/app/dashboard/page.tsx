import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";
import { LAST_LEAGUE_COOKIE, lastLeagueSlug } from "@/lib/last-league";
import { TeamDashboard } from "./TeamDashboard";

/**
 * /dashboard — a legacy team login's dashboard, exactly as before.
 *
 * A person can be on teams in several leagues, so their dashboards live at /[leagueSlug]/dashboard;
 * here they go to the league they used last (or their home page / admin dashboard).
 */
export default async function DashboardPage() {
  const viewer = await resolveViewer();
  if (viewer.authenticated && viewer.type !== "team") {
    const last = lastLeagueSlug((await cookies()).get(LAST_LEAGUE_COOKIE)?.value);
    redirect(last ? `/${last}/dashboard` : viewer.dashboardHref);
  }
  return <TeamDashboard />;
}
