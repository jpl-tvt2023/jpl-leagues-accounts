"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/AppNav";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SHEET_KINDS } from "@/lib/sports/cricket/sheets/types";
import { UploadCard } from "./UploadCard";
import { DataTables } from "./DataTables";

interface Tournament {
  id: string;
  name: string;
  season: string;
  kind: "league" | "window";
  status: "draft" | "ready" | "archived";
  dataVersion: number;
  teams: number;
  players: number;
  fixtures: number;
  fixturesScored: number;
  playoffFixtures: number;
  nextPlayoffIds: Record<string, number>;
  series: string[];
  leagues: Array<{ id: string; slug: string; name: string }>;
}

/** Superadmin: one tournament's uploads and data. */
export default function CricketTournamentPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Reloads whenever `version` moves (after an upload or a fixture action).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}`);
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/signin";
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) setError(data.error ?? "Couldn't load the tournament");
      else setTournament(data.tournament);
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, version]);

  const changed = () => setVersion((v) => v + 1);

  const setStatus = async (status: Tournament["status"]) => {
    const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) changed();
  };

  const remove = async () => {
    if (!tournament || !confirm(`Delete ${tournament.name} and all its data?`)) return;
    const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Couldn't delete");
    else window.location.href = "/superadmin/cricket?tab=tournaments";
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    window.location.href = "/signin";
  };

  if (!tournament && !error) return <LoadingScreen variant="standings" fullScreen />;

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
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:py-10">
        <Link href="/superadmin/cricket?tab=tournaments" className="text-sm text-gray-400 hover:text-white">
          ← Tournaments
        </Link>
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
        {tournament && (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white sm:text-3xl">{tournament.name}</h1>
                <p className="mt-1 text-sm text-gray-400">
                  {tournament.kind === "league" ? "League with franchises" : "Window of series"} · season {tournament.season} ·{" "}
                  {tournament.teams} teams · {tournament.players} players · {tournament.fixtures} fixtures
                  {tournament.playoffFixtures > 0 && ` (${tournament.playoffFixtures} playoffs)`} · {tournament.fixturesScored} scored
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  {tournament.leagues.length
                    ? <>Played by {tournament.leagues.map((l, i) => (
                        <Fragment key={l.id}>
                          {i > 0 && ", "}
                          <Link href={`/${l.slug}/cricket/standings`} className="text-green-300 hover:underline">
                            {l.name}
                          </Link>
                        </Fragment>
                      ))}</>
                    : "No league plays this tournament yet."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={tournament.status}
                  onChange={(e) => setStatus(e.target.value as Tournament["status"])}
                  aria-label="Status"
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                >
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="archived">Archived</option>
                </select>
                {tournament.leagues.length === 0 && (
                  <button type="button" onClick={remove} className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
                    Delete
                  </button>
                )}
              </div>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              {SHEET_KINDS.map((kind) => (
                <UploadCard
                  key={kind}
                  tournamentId={tournament.id}
                  kind={kind}
                  tournamentKind={tournament.kind}
                  nextPlayoffIds={tournament.nextPlayoffIds}
                  series={tournament.series}
                  onCommitted={changed}
                />
              ))}
            </div>

            <DataTables tournamentId={tournament.id} version={version} onChanged={changed} />
          </>
        )}
      </main>
    </div>
  );
}
