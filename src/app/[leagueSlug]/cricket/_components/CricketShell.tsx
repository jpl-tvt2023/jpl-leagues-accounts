"use client";

import type { ReactNode } from "react";
import { LeagueNav } from "@/components/LeagueNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useLeague } from "@/lib/league-context";
import { CRICKET_AUCTION_FORMAT } from "@/lib/sports/registry";

/** Page frame for every cricket league page: the league nav, a heading, and the content. */
export function CricketShell({
  currentPage,
  title,
  subtitle,
  loading,
  error,
  wide,
  children,
}: {
  /** Nav key of this page (standings, fixtures, …). */
  currentPage: string;
  title: string;
  subtitle?: ReactNode;
  loading?: boolean;
  error?: string | null;
  wide?: boolean;
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
      />
      <main className={`mx-auto ${wide ? "max-w-6xl" : "max-w-4xl"} px-4 py-6 sm:px-6 sm:py-10`}>
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-gray-400">{subtitle}</div>}
        </header>
        {error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        ) : loading ? (
          <LoadingScreen variant="standings" />
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
