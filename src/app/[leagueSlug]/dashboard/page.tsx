import { TeamDashboard } from "@/app/dashboard/TeamDashboard";

/** /[leagueSlug]/dashboard — your team's dashboard in this league. */
export default async function LeagueDashboardPage({ params }: { params: Promise<{ leagueSlug: string }> }) {
  const { leagueSlug } = await params;
  return <TeamDashboard routeSlug={leagueSlug} />;
}
