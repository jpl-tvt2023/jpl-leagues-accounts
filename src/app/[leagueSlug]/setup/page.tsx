import { TeamSetup } from "@/app/setup/TeamSetup";

/** /[leagueSlug]/setup — set up your team in this league (members-mode leagues). */
export default async function LeagueSetupPage({ params }: { params: Promise<{ leagueSlug: string }> }) {
  const { leagueSlug } = await params;
  return <TeamSetup leagueSlug={leagueSlug} />;
}
