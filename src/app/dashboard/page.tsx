import { redirect } from "next/navigation";
import { resolveViewer } from "@/lib/viewer";

/**
 * /dashboard — kept as a stable entry point (old links, bookmarks).
 *
 * A person can be in several leagues, so there's no one dashboard to land on: their home (`/`)
 * lists every league they're part of, and each league's own dashboard lives at
 * /[leagueSlug]/dashboard, opened from there.
 */
export default async function DashboardPage() {
  const viewer = await resolveViewer();
  if (!viewer.authenticated) redirect("/signin?next=/");
  redirect("/");
}
