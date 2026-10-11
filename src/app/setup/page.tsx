import { redirect } from "next/navigation";

/**
 * /setup — the old team-login setup wizard. Teams are set up per league at /[leagueSlug]/setup;
 * /dashboard knows which league to send a person to. Kept as a redirect for old links.
 */
export default function SetupPage() {
  redirect("/dashboard");
}
