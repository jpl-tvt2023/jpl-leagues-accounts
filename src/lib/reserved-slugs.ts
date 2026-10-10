/**
 * League slugs that can't be used because a top-level route already owns the path.
 *
 * Leagues live at /<slug>, and Next.js matches static routes before the dynamic [leagueSlug]
 * one — so a league slugged "help" would be shadowed by the /help page and nobody could reach it.
 * tests/unit/reserved-slugs.test.ts fails if a top-level folder under src/app is missing here.
 */
export const RESERVED_LEAGUE_SLUGS = new Set([
  // top-level routes (src/app/*)
  "account", "admin", "api", "app-version", "auth", "change-password", "dashboard", "go", "help", "join",
  "launch", "notifications", "onboarding", "privacy", "settings", "setup", "signin", "superadmin",
  // files Next serves at the root
  "manifest.webmanifest", "favicon.ico", "icon.png", "apple-icon.png", "sw.js", "robots.txt", "sitemap.xml",
  // likely future routes — cheaper to reserve now than to migrate a league later
  "login", "logout", "signup", "register", "u", "user", "users", "me", "terms", "about", "contact", "static", "_next",
]);

export function isReservedLeagueSlug(slug: string): boolean {
  return RESERVED_LEAGUE_SLUGS.has(slug.toLowerCase());
}
