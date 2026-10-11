"use client";

import { AppNav } from "./AppNav";
import { getFormatPalette } from "@/lib/format-palette";
import { useOptionalLeague } from "@/lib/league-context";

export interface LeagueNavProps {
  leagueSlug: string;
  leagueName: string;
  currentPage: string;
  format: "auction" | "continental-championship" | "tvt" | "fpl-classic";
  /** Optional: when provided, distinguishes TVT-8 / TVT-16 / TVT-32 in the format chip. */
  teamSize?: number | null;
  /** Auction-only: "primary" hides the Marketplace tab (trades disabled). Defaults to "complete". */
  auctionTier?: "primary" | "complete" | null;
  isLoggedIn: boolean;
  dashboardHref: string;
  onSignOut: () => void;
  /** Phone app-bar title override; defaults to the active link's label. */
  title?: string;
  /** Hide the phone bottom navigation bar on this page (e.g. the live auction room). */
  hideBottomNav?: boolean;
}

/**
 * League-page navigation.
 *
 * A thin adapter over `AppNav` — the links themselves live in `src/lib/nav-links.ts` and
 * the chrome (desktop bar + mobile drawer) lives in `AppNav`. This wrapper exists only so
 * the ~20 league pages that already pass these props keep working unchanged; new call
 * sites should use `AppNav` directly.
 */
export function LeagueNav({
  leagueSlug,
  leagueName,
  currentPage,
  format,
  teamSize = null,
  auctionTier = null,
  isLoggedIn,
  dashboardHref,
  onSignOut,
  title,
  hideBottomNav,
}: LeagueNavProps) {
  const palette = getFormatPalette(format, teamSize);

  // A person has a dashboard and team page per league, so inside a league point at that league's
  // own — whatever the page passed as a fallback.
  const viewer = useOptionalLeague()?.viewer;
  const isPerson = !!viewer?.authenticated;
  const hasTeamHere = isPerson && !!viewer?.teamId;
  const effectiveDashboardHref = hasTeamHere ? `/${leagueSlug}/dashboard` : dashboardHref;
  const settingsHref = isPerson ? (hasTeamHere ? `/${leagueSlug}/team` : "/account") : undefined;

  return (
    <AppNav
      context={{
        surface: "league",
        leagueSlug,
        format,
        auctionTier,
        isLoggedIn,
        dashboardHref: effectiveDashboardHref,
        settingsHref,
      }}
      activeKey={currentPage}
      brandHref="/"
      brandLabel={leagueName || "League"}
      brandBadge={{ label: palette.label, bgClass: palette.badgeBg, textClass: palette.badgeText }}
      activeTextClass={palette.badgeText}
      activeBgClass={palette.badgeBg}
      title={title}
      hideBottomNav={hideBottomNav}
      onSignOut={onSignOut}
    />
  );
}
