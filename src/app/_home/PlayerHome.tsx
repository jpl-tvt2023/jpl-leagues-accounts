"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { InstallBanner } from "@/components/pwa/InstallBanner";
import { signOutAccounts } from "@/lib/accounts-client";
import type { Overview, OverviewSummary, TodoItem } from "@/lib/dashboard/overview";
import { LeagueStatusCard } from "./LeagueStatusCard";
import { PublicLeagueCard } from "./PublicLeagueCard";
import { SportSection, SportSubsection } from "./SportSection";
import { formatCountdown } from "./format";

/** Refetch when the tab comes back after this long, so ranks and to-dos aren't stale. */
const STALE_MS = 60_000;

/**
 * The signed-in home page: every league the person is part of, grouped by sport, with where they
 * stand and what needs doing — before they pick a league. A league's own dashboard opens from its
 * card.
 */
export function PlayerHome() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  // Server clock minus ours, so countdowns don't drift with a wrong device clock.
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const loadedAt = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/me/overview", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/signin";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Overview;
      setSkew(Date.parse(body.serverTime) - Date.now());
      setData(body);
      setError(false);
      loadedAt.current = Date.now();
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > STALE_MS) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(tick);
    };
  }, [load]);

  const serverNow = now + skew;

  const signOut = async () => {
    await signOutAccounts();
    window.location.href = "/";
  };

  const firstName = data?.person.name?.trim().split(/\s+/)[0] || data?.person.username || null;
  const hasLeagues = !!data && data.sports.some((s) => s.mine.length > 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <AppNav
        context={{ surface: "public", page: "home", signedIn: true }}
        activeKey=""
        brandHref="/"
        brandLabel="JPL India"
        title="My leagues"
        onSignOut={signOut}
      />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-yellow-400">JPL India</p>
          <h1 className="mt-1 text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
            {firstName ? `Welcome back, ${firstName}` : "Your leagues"}
          </h1>
          <p className="mt-1 text-sm text-gray-400">Everything you&apos;re part of, in one place. Pick a league to open it.</p>
        </header>

        <InstallBanner className="mb-6" />

        {!data ? (
          error ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-gray-300">
              Couldn&apos;t load your leagues.{" "}
              <button type="button" onClick={() => void load()} className="font-semibold text-yellow-400 hover:text-yellow-300">
                Try again
              </button>
            </div>
          ) : (
            <HomeSkeleton />
          )
        ) : (
          <>
            {error && (
              <p className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-200">
                Couldn&apos;t refresh just now — showing what we had.
              </p>
            )}

            {hasLeagues && <SummaryStrip summary={data.summary} now={serverNow} />}
            {data.todo.length > 0 && <TodoList items={data.todo} now={serverNow} />}

            {data.allLeagues && (
              <Link
                href="/admin"
                className="mb-8 flex items-center justify-between rounded-2xl border border-orange-400/30 bg-orange-500/10 p-4 transition hover:bg-orange-500/15"
              >
                <span>
                  <span className="block font-bold text-white">All leagues</span>
                  <span className="block text-sm text-gray-300">You run the platform</span>
                </span>
                <span className="text-sm font-semibold text-orange-300">Platform admin →</span>
              </Link>
            )}

            {!hasLeagues && !data.allLeagues && (
              <p className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-gray-300">
                You&apos;re not in a league yet. Ask a league&apos;s admin for an invite link and open it to join.
              </p>
            )}

            {data.sports.map((sport) => (
              <SportSection key={sport.sport} sport={sport.sport} label={sport.label} icon={sport.icon}>
                {sport.mine.length > 0 && (
                  <SportSubsection id={`${sport.sport}-mine`} title="Your leagues">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
                      {sport.mine.map((card) => (
                        <LeagueStatusCard key={card.leagueId} card={card} now={serverNow} />
                      ))}
                    </div>
                  </SportSubsection>
                )}
                {sport.others.length > 0 && (
                  <SportSubsection id={`${sport.sport}-others`} title="Other leagues">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
                      {sport.others.map((league) => (
                        <PublicLeagueCard key={league.id} league={league} compact />
                      ))}
                    </div>
                  </SportSubsection>
                )}
              </SportSection>
            ))}

            {data.sports.some((s) => s.others.length > 0) && (
              <p className="text-center text-xs text-gray-500">
                Want to join one of the other leagues? Ask its admin for an invite link.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-xl sm:text-2xl font-semibold text-white">{value}</p>
      {detail && <p className="mt-0.5 truncate text-xs text-gray-400">{detail}</p>}
    </div>
  );
}

function SummaryStrip({ summary: s, now }: { summary: OverviewSummary; now: number }) {
  const leagueDetail = [s.playing > 0 ? `${s.playing} playing` : null, s.running > 0 ? `${s.running} running` : null]
    .filter(Boolean)
    .join(" · ");
  const deadlineMs = s.nextDeadline ? Date.parse(s.nextDeadline.at) - now : null;

  return (
    <section aria-label="Summary" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Leagues" value={String(s.leagues)} detail={leagueDetail || undefined} />
      <Tile
        label="Next deadline"
        value={s.nextDeadline && deadlineMs !== null && deadlineMs > 0 ? formatCountdown(deadlineMs) : "—"}
        detail={s.nextDeadline ? `GW${s.nextDeadline.gw}` : "None scheduled"}
      />
      <Tile
        label={s.lastGw ? `GW${s.lastGw.gw} record` : "Last gameweek"}
        value={s.lastGw ? `${s.lastGw.wins}W ${s.lastGw.draws}D ${s.lastGw.losses}L` : "—"}
        detail={s.lastGw ? "Head-to-head leagues" : "No results yet"}
      />
      <Tile
        label="Needs attention"
        value={String(s.todoCount)}
        detail={s.todoCount === 0 ? "You're all set" : s.todoCount === 1 ? "1 thing to do" : `${s.todoCount} things to do`}
      />
    </section>
  );
}

function TodoList({ items, now }: { items: TodoItem[]; now: number }) {
  return (
    <section aria-labelledby="todo-heading" className="mb-10">
      <h2 id="todo-heading" className="mb-3 text-lg font-bold text-white">Needs your attention</h2>
      <ul className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {items.map((item) => {
          const left = item.dueAt ? Date.parse(item.dueAt) - now : null;
          return (
            <li key={item.id}>
              <Link href={item.href} className="flex min-h-14 items-center gap-3 px-4 py-3 transition hover:bg-white/5">
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    item.urgent ? "bg-amber-500/20 text-amber-200" : "bg-white/10 text-gray-300"
                  }`}
                >
                  {item.urgent ? "!" : "i"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{item.text}</span>
                  <span className="block truncate text-xs text-gray-400">
                    {item.leagueName}
                    {left !== null && left > 0 ? ` · ${formatCountdown(left)} left` : ""}
                  </span>
                </span>
                <span aria-hidden="true" className="text-gray-500">›</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your leagues">
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-56 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
    </div>
  );
}
