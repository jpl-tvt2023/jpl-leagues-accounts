"use client";

import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { groupBySport } from "@/lib/sports";
import { PublicLeagueCard, type PublicLeague } from "./PublicLeagueCard";
import { SportSection } from "./SportSection";

/** The landing page for signed-out visitors: every active league, grouped by sport. */
export function PublicHome() {
  const [leagues, setLeagues] = useState<PublicLeague[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leagues")
      .then((r) => r.json())
      .then((data) => setLeagues(data.leagues || []))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <AppNav
        context={{ surface: "public", page: "home", signedIn: false }}
        activeKey=""
        brandHref="/"
        brandLabel="JPL India"
      />

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-4 sm:px-6 py-12 sm:py-20 text-center">
        <p className="mb-2 sm:mb-3 text-xs sm:text-sm font-semibold uppercase tracking-widest text-yellow-400">
          JPL India
        </p>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white">
          Fantasy League Hub
        </h1>
        <p className="mx-auto mt-3 sm:mt-5 max-w-xl text-sm sm:text-base text-gray-400">
          Choose your league and compete. Multiple formats, one platform.
        </p>
      </section>

      {/* League cards, one section per sport */}
      <div className="mx-auto max-w-5xl px-4 pb-12 sm:pb-24 sm:px-6">
        <InstallBanner className="mb-6" />
        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
            ))}
          </div>
        ) : leagues.length === 0 ? (
          <p className="text-center text-gray-500">No leagues available yet.</p>
        ) : (
          groupBySport(leagues).map((group) => (
            <SportSection key={group.sport} sport={group.sport} label={group.label} icon={group.icon}>
              <div className="grid gap-6 sm:grid-cols-2 items-stretch">
                {group.items.map((league) => (
                  <PublicLeagueCard key={league.id} league={league} />
                ))}
              </div>
            </SportSection>
          ))
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-slate-900/50 py-8 text-center text-sm text-gray-500">
        JPL India © 2026 &mdash; Multiple fantasy sports, one league platform.
      </footer>
    </div>
  );
}
