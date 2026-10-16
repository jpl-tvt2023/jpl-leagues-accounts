"use client";

import type { ReactNode } from "react";
import { LeagueNav } from "@/components/LeagueNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useLeague } from "@/lib/league-context";
import { CRICKET_AUCTION_FORMAT } from "@/lib/sports/registry";

const LOADING_LABELS: Record<string, string> = {
  auction: "Loading the auction",
  dashboard: "Loading your dashboard",
  fixtures: "Loading fixtures",
  help: "Loading help",
  players: "Loading the player pool",
  rules: "Loading rules",
  squad: "Loading your squad",
  standings: "Loading standings",
  teams: "Loading squads",
  winners: "Loading winners",
};

const MAX_WIDTH = { "4xl": "max-w-4xl", "6xl": "max-w-6xl", "7xl": "max-w-7xl" } as const;

/** Page frame for every cricket league page: the league nav, a heading, and the content. */
export function CricketShell({
  currentPage,
  title,
  subtitle,
  loading,
  error,
  wide,
  maxWidth,
  hideBottomNav,
  children,
}: {
  /** Nav key of this page (standings, fixtures, …). */
  currentPage: string;
  /** Page heading; leave it out when the page draws its own header (the auction room). */
  title?: ReactNode;
  subtitle?: ReactNode;
  loading?: boolean;
  error?: string | null;
  /** Shorthand for maxWidth="6xl". */
  wide?: boolean;
  maxWidth?: keyof typeof MAX_WIDTH;
  /** Hide the phone bottom navigation bar (the live auction room needs the space). */
  hideBottomNav?: boolean;
  children?: ReactNode;
}) {
  const { league, viewer } = useLeague();
  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/signin";
  };
  return (
    <>
      <LeagueNav
        leagueSlug={league.slug}
        leagueName={league.name}
        currentPage={currentPage}
        format={CRICKET_AUCTION_FORMAT}
        teamSize={league.teamSize}
        isLoggedIn={viewer.authenticated}
        dashboardHref={viewer.dashboardHref}
        onSignOut={handleSignOut}
        hideBottomNav={hideBottomNav}
      />
      <main className={`mx-auto ${MAX_WIDTH[maxWidth ?? (wide ? "6xl" : "4xl")]} px-4 py-6 sm:px-6 sm:py-10`}>
        {title !== undefined && (
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
            {subtitle && <div className="mt-1 text-sm text-gray-400">{subtitle}</div>}
          </header>
        )}
        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        ) : loading ? (
          <LoadingScreen variant="cricket" fullScreen={false} label={LOADING_LABELS[currentPage]} />
        ) : (
          children
        )}
      </main>
    </>
  );
}

/** A translucent card, the building block of the cricket pages. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5 ${className}`}>{children}</section>;
}
