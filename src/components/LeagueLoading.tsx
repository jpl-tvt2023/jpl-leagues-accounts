"use client";

import { LoadingScreen } from "@/components/LoadingScreen";
import { useOptionalLeague } from "@/lib/league-context";
import { isCricketFormat } from "@/lib/sports/registry";

/**
 * The loading screen while a league page renders. The league layout already paints the format's
 * background, so a cricket league gets the green loader on it; every other format keeps the
 * purple full-screen loader.
 */
export function LeagueLoading() {
  const ctx = useOptionalLeague();
  if (ctx && isCricketFormat(ctx.league.format)) {
    return <LoadingScreen variant="cricket" bgClass="bg-transparent" label="Loading League" />;
  }
  return <LoadingScreen variant="default" label="Loading League" />;
}
