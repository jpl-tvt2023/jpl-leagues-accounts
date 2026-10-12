/**
 * Where a cricket league's pages live, and where to send someone who opens one of the FPL pages
 * for a cricket league (an old bookmark, a hand-typed URL, a shared link).
 *
 * Cricket leagues use only /[slug]/cricket/* plus a few generic pages. Every other page under
 * /[slug] was written for FPL formats and falls back to TVT for anything it doesn't recognise, so it
 * must never render for a cricket league. Pure — no react/next imports — so it is unit-testable.
 */

/** Generic league pages that work for every format, cricket included. */
const SHARED_PAGES = new Set(["feedback", "team", "setup"]);

/** FPL page → its cricket counterpart, where one exists. */
const CRICKET_EQUIVALENT: Record<string, string> = {
  dashboard: "dashboard",
  standings: "standings",
  fixtures: "fixtures",
  "gw-results": "fixtures",
  "match-center": "fixtures",
  teams: "squads",
  players: "players",
  squad: "squad",
  auction: "auction",
  winners: "winners",
  rules: "rules",
  help: "help",
};

export function cricketPath(slug: string, page: string): string {
  return `/${slug}/cricket/${page}`;
}

/**
 * The cricket page to redirect to for `pathname` in a cricket league, or null when the page is
 * already one a cricket league may show.
 */
export function cricketRedirectTarget(slug: string, pathname: string): string | null {
  const base = `/${slug}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null; // not this league's page
  const rest = pathname.slice(base.length).replace(/^\/+/, "");
  const first = rest.split("/")[0] ?? "";
  if (first === "cricket" || SHARED_PAGES.has(first)) return null;
  return cricketPath(slug, CRICKET_EQUIVALENT[first] ?? "standings");
}
