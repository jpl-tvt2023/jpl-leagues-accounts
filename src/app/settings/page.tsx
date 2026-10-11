import { redirect } from "next/navigation";

/**
 * /settings — the old team-login settings page. Everyone has an account now: profile and devices
 * live at /account, and each team's name at /[leagueSlug]/team. Kept as a redirect for old links.
 */
export default function SettingsPage() {
  redirect("/account");
}
