"use client";

import { useEffect, useState } from "react";

/** What /api/me/leagues returns: everything the league switcher and the My Leagues hub list. */
export interface MyLeagues {
  teams: Array<{
    leagueId: string;
    slug: string;
    leagueName: string;
    format: string;
    season: string;
    isActive: boolean;
    teamId: string;
    teamName: string;
    /** Every FPL slot on the team is filled. */
    isProfileComplete: boolean;
    /** This person hasn't done their own part of team setup yet. */
    needsSetup: boolean;
    role: "owner" | "member";
  }>;
  adminOf: Array<{ leagueId: string; slug: string; leagueName: string; format: string; season: string }>;
  allLeagues: boolean;
  pending: Array<{ requestId: string; leagueId: string; slug: string; leagueName: string }>;
}

/** Where a team entry goes: setup until the person has done their part of it, then the dashboard. */
export function teamHref(t: MyLeagues["teams"][number]): string {
  return t.needsSetup ? `/${t.slug}/setup` : `/${t.slug}/dashboard`;
}

/**
 * The signed-in person's leagues. `null` while loading (or when `enabled` is false); `undefined`
 * when there is no person to ask about (signed out, or a legacy team login).
 */
export function useMyLeagues(enabled = true): MyLeagues | null | undefined {
  const [data, setData] = useState<MyLeagues | null | undefined>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/me/leagues", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : undefined))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setData(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return data;
}
