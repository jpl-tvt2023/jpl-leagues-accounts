"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { LoadingScreen } from "@/components/LoadingScreen";

interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  season: string;
  kind: "league" | "window";
  status: "draft" | "ready" | "archived";
  teams: number;
  players: number;
  fixtures: number;
  fixturesScored: number;
  leagues: Array<{ id: string; slug: string; name: string }>;
}

const STATUS_STYLE: Record<TournamentRow["status"], string> = {
  draft: "bg-gray-500/20 text-gray-300",
  ready: "bg-green-500/20 text-green-300",
  archived: "bg-slate-500/20 text-slate-400",
};

/** Superadmin: the cricket tournaments whose data leagues play on. */
export default function CricketTournamentsPage() {
  const [tournaments, setTournaments] = useState<TournamentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [kind, setKind] = useState<"league" | "window">("league");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/superadmin/cricket/tournaments");
    if (res.status === 401 || res.status === 403) {
      window.location.href = "/signin";
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Couldn't load tournaments");
      setTournaments([]);
      return;
    }
    setTournaments(data.tournaments);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/superadmin/cricket/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, season, kind }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't create the tournament");
        return;
      }
      window.location.href = `/superadmin/cricket/${data.tournament.id}`;
    } finally {
      setCreating(false);
    }
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/signin";
  };

  if (tournaments === null) return <LoadingScreen variant="standings" fullScreen />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-green-900/40 to-slate-900">
      <AppNav
        context={{ surface: "superadmin" }}
        activeKey="superadmin-cricket"
        brandHref="/superadmin"
        brandLabel="Platform Admin"
        brandBadge={{ label: "Superadmin", bgClass: "bg-yellow-400/20", textClass: "text-yellow-400" }}
        onSignOut={handleSignOut}
      />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Cricket tournaments</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-400">
          A tournament holds the teams, players, fixtures and points that cricket leagues play on. Upload them here as
          spreadsheets; every league linked to the tournament scores from the same data.
        </p>

        {error && <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className="mt-8 grid gap-4">
          {tournaments.length === 0 && <p className="text-sm text-gray-400">No tournaments yet.</p>}
          {tournaments.map((t) => (
            <Link
              key={t.id}
              href={`/superadmin/cricket/${t.id}`}
              className="block rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-green-400/40 hover:bg-white/10"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-white">{t.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-300">{t.kind === "league" ? "League (franchises)" : "Window (series)"}</span>
              </div>
              <div className="mt-2 text-sm text-gray-400">
                {t.teams} teams · {t.players} players · {t.fixtures} fixtures ({t.fixturesScored} scored)
                {t.leagues.length > 0 && <> · played by {t.leagues.map((l) => l.name).join(", ")}</>}
              </div>
            </Link>
          ))}
        </div>

        <form onSubmit={create} className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-lg font-semibold text-white">New tournament</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block text-sm text-gray-300">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="IPL 2026"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-gray-300">
              Season
              <input
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                placeholder="2026"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
              />
            </label>
            <label className="block text-sm text-gray-300">
              Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "league" | "window")}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white"
              >
                <option value="league">League — one competition with franchises (IPL)</option>
                <option value="window">Window — several series over a month or quarter</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim() || !season.trim()}
            className="mt-4 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create tournament"}
          </button>
        </form>
      </main>
    </div>
  );
}
