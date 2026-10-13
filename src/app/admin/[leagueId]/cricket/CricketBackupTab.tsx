"use client";

import { useEffect, useRef, useState } from "react";

interface Snapshot {
  id: string;
  trigger: "manual" | "player-auction-complete";
  createdAt: string;
  squads: number;
  franchises: number;
}

const BTN = "rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 disabled:opacity-50";
const TRIGGER: Record<Snapshot["trigger"], string> = { manual: "Taken by hand", "player-auction-complete": "Player auction completed" };

/**
 * Backup, as in the FPL console: download the league's auction state, keep snapshots, restore one.
 * A restore replaces every squad, franchise, purse and penalty with the backup's; it needs the
 * league's slug typed to confirm, and no auction session may be running.
 */
export function CricketBackupTab({
  leagueId,
  leagueSlug,
  onMessage,
  onRestored,
}: {
  leagueId: string;
  leagueSlug: string;
  onMessage: (m: { type: "success" | "error"; text: string }) => void;
  onRestored: () => void;
}) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/${leagueId}/cricket/backups`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!cancelled) setSnapshots(res.ok ? body.backups : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, version]);

  const confirmRestore = (what: string) => {
    const typed = prompt(`Restore ${what}? Every squad, franchise, purse and penalty in this league is replaced.\n\nType the league slug (${leagueSlug}) to confirm:`);
    return typed === leagueSlug;
  };

  const restore = async (init: RequestInit) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/${leagueId}/cricket/restore`, { method: "POST", ...init });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onMessage({ type: "error", text: (body.errors as string[] | undefined)?.join(" · ") ?? body.error ?? "Restore failed" });
        return;
      }
      const c = body.counts as { squads: number; franchises: number; penalties: number };
      onMessage({ type: "success", text: `Restored: ${c.squads} squad players, ${c.franchises} franchises, ${c.penalties} penalties.` });
      onRestored();
    } finally {
      setBusy(false);
    }
  };

  const takeNow = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/${leagueId}/cricket/backups`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) onMessage({ type: "error", text: body.error ?? "Couldn't take a backup" });
      else {
        onMessage({ type: "success", text: "Backup saved." });
        setVersion((v) => v + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const restoreFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file || !confirmRestore(`from ${file.name}`)) return;
    const form = new FormData();
    form.append("file", file);
    await restore({ body: form });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Backup</h2>
        <p className="mt-1 text-sm text-gray-400">
          A backup is the league&apos;s auction state: team names and purses, every squad, franchise and penalty, and the auction sessions. Tournament data
          (players, fixtures, points) lives with the tournament and isn&apos;t part of it.
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-xl font-bold text-white">Backup current data</h3>
        <p className="mt-1 text-sm text-gray-400">
          Downloads a .zip with backup.json (what a restore reads) and readable sheets: Teams, Squads, Franchises, Penalties, Settings.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={`/api/admin/${leagueId}/cricket/backup`} className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-yellow-400">
            Download Backup (.zip)
          </a>
          <button type="button" disabled={busy} onClick={takeNow} className={BTN} title="Keeps a snapshot in the database. One is also kept automatically when the player auction completes.">
            Take backup now
          </button>
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={BTN}>
            Restore from file
          </button>
          <input ref={fileInput} type="file" accept=".zip" className="hidden" onChange={(e) => restoreFile(e.target.files?.[0])} />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h3 className="text-sm font-semibold text-white">Saved snapshots</h3>
        <p className="mt-1 text-xs text-gray-500">Kept when taken by hand, and automatically when the player auction completes (squads are final then).</p>
        {snapshots === null ? (
          <p className="mt-3 text-sm text-gray-400">Loading…</p>
        ) : snapshots.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5 text-sm">
            {snapshots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-gray-200">
                  {new Date(s.createdAt).toLocaleString("en-IN")} · <span className="text-gray-400">{TRIGGER[s.trigger]}</span> · {s.squads} squad players, {s.franchises}{" "}
                  franchises
                </span>
                <span className="flex gap-3">
                  <a href={`/api/admin/${leagueId}/cricket/backups/${s.id}`} className="text-green-300 hover:underline">
                    Download
                  </a>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => confirmRestore(`the snapshot from ${new Date(s.createdAt).toLocaleString("en-IN")}`) && restore({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backupId: s.id }) })}
                    className="text-yellow-300 hover:underline disabled:opacity-50"
                  >
                    Restore
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
