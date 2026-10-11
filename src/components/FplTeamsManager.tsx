"use client";

import { useEffect, useState } from "react";
import { AddFplTeamForm, PrimaryBadge, fplTeamLabel } from "@/components/FplTeamPicker";

interface SavedFplTeam {
  id: string;
  fplEntryId: string;
  teamName: string | null;
  managerName: string | null;
  isPrimary: boolean;
  playingIn: Array<{ leagueName: string; leagueSlug: string }>;
}

/**
 * "Your FPL teams" on /account: every FPL team the person runs, which one is primary (picked by
 * default when they join a league), and where each is playing. Removing one doesn't change a league
 * already playing with it.
 */
export function FplTeamsManager() {
  const [teams, setTeams] = useState<SavedFplTeam[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/me/fpl-teams", { cache: "no-store" });
    if (res.ok) setTeams((await res.json()).fplTeams);
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (id: string, method: "PATCH" | "DELETE") => {
    setBusy(id);
    setError(null);
    const res = await fetch("/api/me/fpl-teams", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(body.error ?? "Couldn't do that.");
    await load();
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-300 mb-1">Your FPL teams</h3>
      <p className="mb-3 text-xs text-gray-500">
        Only needed for FPL leagues (Team vs Team, Continental); auction leagues don&apos;t use them. When you join an FPL league
        you pick one of these to play with, and your primary is picked for you. Removing one here doesn&apos;t change a league
        already playing with it.
      </p>
      {teams === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : teams.length === 0 ? (
        <p className="mb-3 text-sm text-gray-400">No FPL teams yet.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-white">{fplTeamLabel(t)}</span>
                  {t.isPrimary && <PrimaryBadge />}
                </span>
                <span className="block truncate text-xs text-gray-400">
                  ID {t.fplEntryId}
                  {t.playingIn.length > 0 && ` · plays in ${t.playingIn.map((l) => l.leagueName).join(", ")}`}
                </span>
              </span>
              <span className="flex shrink-0 gap-2">
                {!t.isPrimary && (
                  <button type="button" onClick={() => act(t.id, "PATCH")} disabled={busy !== null} className="text-xs text-yellow-400 underline disabled:opacity-50">
                    Make primary
                  </button>
                )}
                <button type="button" onClick={() => act(t.id, "DELETE")} disabled={busy !== null} className="text-xs text-gray-400 underline hover:text-red-300 disabled:opacity-50">
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <AddFplTeamForm onAdded={() => void load()} />
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
