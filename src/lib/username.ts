/**
 * Usernames: one unique handle per person, shown to teammates and admins and used by admins to
 * assign people to teams. Stored lowercase; uniqueness is the users_username_unique index.
 */

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Names that would impersonate the platform or collide with routes a future /u/<username> or
 * top-level link might use.
 */
const RESERVED = new Set([
  "admin", "administrator", "superadmin", "root", "system", "support", "help", "staff", "mod", "moderator",
  "jpl", "jplindia", "jplleagues", "official", "team", "teams", "league", "leagues",
  "api", "app", "auth", "account", "accounts", "settings", "signin", "signout", "login", "logout", "register",
  "join", "invite", "onboarding", "dashboard", "setup", "notifications", "privacy", "terms", "launch",
  "me", "you", "null", "undefined", "anonymous", "everyone", "here",
]);

/** Lowercase and trim; also strips a leading "@" people type out of habit. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** Why a (normalized) username can't be used, or null if it can — uniqueness aside. */
export function usernameProblem(username: string): string | null {
  if (username.length < 3) return "Usernames are at least 3 characters.";
  if (username.length > 20) return "Usernames are at most 20 characters.";
  if (!USERNAME_RE.test(username)) return "Use only lowercase letters, numbers and underscores.";
  if (/^_|_$/.test(username)) return "Usernames can't start or end with an underscore.";
  if (/^\d+$/.test(username)) return "Usernames need at least one letter.";
  if (RESERVED.has(username)) return "That username is reserved.";
  return null;
}
