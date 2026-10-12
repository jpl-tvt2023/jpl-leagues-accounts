"use client";

import { createContext, useContext, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { getFormatPalette, type FormatPalette } from "@/lib/format-palette";
import type { LeagueFormat } from "@/lib/sports/registry";

// The union lives in the format registry. Widening it only loosens useEnforceFormat's ARGUMENT type
// below — every existing call site passes a literal array that still excludes the newer formats,
// so they keep 404ing them exactly as before. Adding a format does not, by itself, grant it access
// to anything.
export type { LeagueFormat };

export interface LeagueInfo {
  id: string;
  slug: string;
  name: string;
  sport: string;
  format: string; // one of LeagueFormat (src/lib/sports/registry.ts)
  season: string;
  teamSize: number;
  groupCount: number;
  playoffStartGw: number;
  enabledChips: string[];
  initialBudget: number;
  // Auction-only — "primary" disables trades + slot expansion. Default "complete" for legacy
  // (TVT/continental-championship leagues default to "complete" too but never act on it).
  auctionTier?: "primary" | "complete";
  // Auction-only — first gameweek the league scores. 1 for every other format.
  startGameweek: number;
  // Auction-only — gameweeks at which pending releases finalize, already parsed from the
  // stored JSON. Carried here so squad / marketplace / rules copy all name the same
  // gameweeks instead of each hardcoding "GW 10/20/30".
  releaseCycleGws: number[];
  /**
   * "members": people join via invite and sign in with Google. "legacy": a league from before
   * accounts, whose team logins no longer work — nobody can act for its teams until the superadmin
   * switches it to "members".
   */
  authMode: "legacy" | "members";
  // fpl-classic only. Present so the standings/rules pages need no second fetch just to show
  // which official FPL mini-league this page mirrors, and on what terms it is scored.
  fplLeagueId?: number | null;
  fplScoringMetric?: "net" | "gross";
  fplWinnerCutPercent?: number;
}

export interface ViewerInfo {
  authenticated: boolean;
  /** A person's platform role ("user" = player), or null when signed out. */
  type: "user" | "admin" | "superadmin" | null;
  dashboardHref: string;
  /**
   * Under /[leagueSlug]/*: the viewer's team in THIS league (their membership here); absent when
   * they have none. Use it to decide "my team".
   */
  teamId?: string;
  userId?: string;
  username?: string | null;
  adminLeagueId?: string | null;
  /** Under /[leagueSlug]/*: superadmin, or an admin of this league. */
  isLeagueAdmin?: boolean;
}

export interface LeagueContextValue {
  league: LeagueInfo;
  viewer: ViewerInfo;
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

export function LeagueProvider({
  value,
  children,
}: {
  value: LeagueContextValue;
  children: ReactNode;
}) {
  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) {
    throw new Error("useLeague must be used within a LeagueProvider (under /[leagueSlug]/*)");
  }
  return ctx;
}

/** The league context, or null outside /[leagueSlug]/* (for components used in both places). */
export function useOptionalLeague(): LeagueContextValue | null {
  return useContext(LeagueContext);
}

// Guard for pages that only make sense for specific league formats. Renders
// the 404 page if the current league's format isn't in the allowed list.
// Call at the top of a page component, before any other hooks that depend
// on the format being valid.
export function useEnforceFormat(allowed: readonly LeagueFormat[]): void {
  const { league } = useLeague();
  if (!allowed.includes(league.format as LeagueFormat)) {
    notFound();
  }
}

/**
 * Resolve the visual palette for the current league. Use whenever a chrome
 * surface should look format-aware (header chip, hero accents, top borders).
 * Returns a stable object — pure function of (format, teamSize) under the hood.
 */
export function useFormatPalette(): FormatPalette {
  const { league } = useLeague();
  return getFormatPalette(league.format, league.teamSize);
}
