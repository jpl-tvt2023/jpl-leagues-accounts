/**
 * The league a person used last, so /dashboard and the installed app's launch can land there.
 * Set by the league dashboard (client); read by server routes — hence its own plain module: a
 * value exported from a "use client" file can't be read on the server.
 */
export const LAST_LEAGUE_COOKIE = "jpl_last_league";

/** A cookie value safe to put in a redirect path, or null. */
export function lastLeagueSlug(value: string | undefined | null): string | null {
  return value && /^[a-z0-9-]{1,80}$/i.test(value) ? value : null;
}
