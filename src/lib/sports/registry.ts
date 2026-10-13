/**
 * The sports JPL India runs, and the league formats each one offers — the single place to start
 * when adding a sport.
 *
 * Each sport's own code lives in its folder: src/lib/sports/fpl/ (football, on top of Fantasy Premier
 * League) and src/lib/sports/cricket/. Only generic plumbing is shared between them: leagues, team
 * identity and membership, auth, and the UI shell. Adding a sport means: a `SPORTS` entry and caps
 * for its formats here, a folder under src/lib/sports/<sport>/, its own tables in
 * src/lib/db/schema-<sport>.ts, and its pages.
 *
 * Most of the FPL code still branches on `format === "..."` directly; the caps below let formats
 * that must NOT fall into those branches (FPL Classic, and cricket, which has no gameweeks at all) be
 * fenced off with one question instead of a list repeated in every file.
 *
 * Formats this file doesn't know keep the behaviour they had before it existed (gameweeks on, one
 * person per team), so an unexpected legacy value is never newly locked out by a guard.
 *
 * Deliberately imports nothing, so it stays unit-testable under `tsx --test` and usable anywhere.
 */

export const TVT_FORMAT = "tvt";
export const CONTINENTAL_FORMAT = "continental-championship";
export const FPL_AUCTION_FORMAT = "auction";
export const FPL_CLASSIC_FORMAT = "fpl-classic";
export const CRICKET_AUCTION_FORMAT = "cricket-auction";

export type LeagueFormat =
  | typeof TVT_FORMAT
  | typeof CONTINENTAL_FORMAT
  | typeof FPL_AUCTION_FORMAT
  | typeof FPL_CLASSIC_FORMAT
  | typeof CRICKET_AUCTION_FORMAT;

export type Sport = "fpl" | "cricket";

export interface SportDef {
  /** How people see the sport. */
  label: string;
  icon: string;
  /** Formats the sport offers, in the order the create-league wizard lists them. */
  formats: readonly LeagueFormat[];
}

export const SPORTS: Record<Sport, SportDef> = {
  fpl: { label: "Football", icon: "⚽", formats: [TVT_FORMAT, CONTINENTAL_FORMAT, FPL_AUCTION_FORMAT, FPL_CLASSIC_FORMAT] },
  cricket: { label: "Cricket", icon: "🏏", formats: [CRICKET_AUCTION_FORMAT] },
};

export function isKnownSport(sport: string | null | undefined): sport is Sport {
  return !!sport && Object.prototype.hasOwnProperty.call(SPORTS, sport);
}

/** What team setup asks a new member for. */
export type SetupMode =
  /** Each member links one of their FPL teams (TVT, Continental). */
  | "fpl-players"
  /** Only a team name; players come from an auction (FPL auction, cricket). */
  | "name-only"
  /** No accounts at all (FPL Classic). */
  | "none";

export interface FormatCaps {
  sport: Sport;
  /** Shown to people, e.g. on the create-league wizard. */
  label: string;
  /** Runs on FPL gameweeks: gameweek rows, FPL deadlines, gameweek scoring, the auto-processing plan. */
  usesGameweeks: boolean;
  /** Most people per team. */
  maxTeamMembers: number;
  setupMode: SetupMode;
}

type Caps = Omit<FormatCaps, "sport">;

const CAPS: Record<LeagueFormat, Caps> = {
  [TVT_FORMAT]: { label: "Team vs Team", usesGameweeks: true, maxTeamMembers: 2, setupMode: "fpl-players" },
  [CONTINENTAL_FORMAT]: { label: "JPL Continental Championship", usesGameweeks: true, maxTeamMembers: 2, setupMode: "fpl-players" },
  [FPL_AUCTION_FORMAT]: { label: "Auction", usesGameweeks: true, maxTeamMembers: 1, setupMode: "name-only" },
  [FPL_CLASSIC_FORMAT]: { label: "FPL Classic", usesGameweeks: false, maxTeamMembers: 1, setupMode: "none" },
  [CRICKET_AUCTION_FORMAT]: { label: "Classic Cricket Auction", usesGameweeks: false, maxTeamMembers: 1, setupMode: "name-only" },
};

/** Format → its sport, from SPORTS (each format belongs to exactly one sport). */
const SPORT_OF = new Map<LeagueFormat, Sport>(
  (Object.keys(SPORTS) as Sport[]).flatMap((sport) => SPORTS[sport].formats.map((f) => [f, sport] as const)),
);

/** Caps for formats this file doesn't know: what the app did for them before the registry. */
const LEGACY_CAPS: FormatCaps = { sport: "fpl", label: "League", usesGameweeks: true, maxTeamMembers: 1, setupMode: "name-only" };

export function isKnownFormat(format: string | null | undefined): format is LeagueFormat {
  return !!format && Object.prototype.hasOwnProperty.call(CAPS, format);
}

export function formatCaps(format: string | null | undefined): FormatCaps {
  return isKnownFormat(format) ? { sport: SPORT_OF.get(format)!, ...CAPS[format] } : LEGACY_CAPS;
}

/** Formats a sport offers when a league is created; none for an unknown sport. */
export function formatsForSport(sport: string): LeagueFormat[] {
  return isKnownSport(sport) ? [...SPORTS[sport].formats] : [];
}

/** True when `format` is one of `sport`'s formats. */
export function formatBelongsToSport(format: string, sport: string): boolean {
  return isKnownFormat(format) && SPORT_OF.get(format) === sport;
}

export function isCricketFormat(format: string | null | undefined): boolean {
  return isKnownFormat(format) && SPORT_OF.get(format) === "cricket";
}

export function usesGameweeks(format: string | null | undefined): boolean {
  return formatCaps(format).usesGameweeks;
}

/** Every known format that has no FPL gameweeks. Gameweek machinery skips these leagues. */
export const NON_GAMEWEEK_FORMATS: readonly LeagueFormat[] = (Object.keys(CAPS) as LeagueFormat[]).filter(
  (f) => !CAPS[f].usesGameweeks,
);
