/**
 * What each league format is, in one place: its sport, whether it runs on FPL gameweeks, how many
 * people share a team, and what team setup asks for.
 *
 * Most of the app still branches on `format === "..."` directly; this module exists so the formats
 * that must NOT fall into those branches (fpl-classic, and the cricket formats, which have no
 * gameweeks at all) can be fenced off with one question instead of a list repeated in every file.
 *
 * Formats this file doesn't know keep the behaviour they had before it existed (gameweeks on, one
 * person per team), so an unexpected legacy value is never newly locked out by a guard below.
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

const CAPS: Record<LeagueFormat, FormatCaps> = {
  [TVT_FORMAT]: { sport: "fpl", label: "Team vs Team", usesGameweeks: true, maxTeamMembers: 2, setupMode: "fpl-players" },
  [CONTINENTAL_FORMAT]: {
    sport: "fpl",
    label: "JPL Continental Championship",
    usesGameweeks: true,
    maxTeamMembers: 2,
    setupMode: "fpl-players",
  },
  [FPL_AUCTION_FORMAT]: { sport: "fpl", label: "Auction", usesGameweeks: true, maxTeamMembers: 1, setupMode: "name-only" },
  [FPL_CLASSIC_FORMAT]: { sport: "fpl", label: "FPL Classic", usesGameweeks: false, maxTeamMembers: 1, setupMode: "none" },
  [CRICKET_AUCTION_FORMAT]: {
    sport: "cricket",
    label: "Classic Cricket Auction",
    usesGameweeks: false,
    maxTeamMembers: 1,
    setupMode: "name-only",
  },
};

/** Caps for formats this file doesn't know: what the app did for them before the registry. */
const LEGACY_CAPS: FormatCaps = { sport: "fpl", label: "League", usesGameweeks: true, maxTeamMembers: 1, setupMode: "name-only" };

export function isKnownFormat(format: string | null | undefined): format is LeagueFormat {
  return !!format && Object.prototype.hasOwnProperty.call(CAPS, format);
}

export function formatCaps(format: string | null | undefined): FormatCaps {
  return isKnownFormat(format) ? CAPS[format] : LEGACY_CAPS;
}

/** Formats a sport offers when a league is created. */
export function formatsForSport(sport: string): LeagueFormat[] {
  return (Object.keys(CAPS) as LeagueFormat[]).filter((f) => CAPS[f].sport === sport);
}

export function isCricketFormat(format: string | null | undefined): boolean {
  return isKnownFormat(format) && CAPS[format].sport === "cricket";
}

export function usesGameweeks(format: string | null | undefined): boolean {
  return formatCaps(format).usesGameweeks;
}

/** Every known format that has no FPL gameweeks. Gameweek machinery skips these leagues. */
export const NON_GAMEWEEK_FORMATS: readonly LeagueFormat[] = (Object.keys(CAPS) as LeagueFormat[]).filter(
  (f) => !CAPS[f].usesGameweeks,
);
