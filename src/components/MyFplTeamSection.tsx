"use client";

import { useEffect, useState } from "react";
import { FplTeamPicker, PrimaryBadge, fplTeamLabel, type FplTeamOption } from "@/components/FplTeamPicker";

interface SetupView {
  mySlot: { id: string; name: string; fplId: string } | null;
  fplTeams: FplTeamOption[];
  lock: { gw: number; deadline: string } | null;
}

const CARD = "rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 backdrop-blur";

/**
 * "Your FPL team" on /[leagueSlug]/team: which of your saved FPL teams plays for you in this league,
 * and a way to switch to another until the league's first gameweek deadline. After that it's fixed
 * and only a league admin can change it.
 */
export function MyFplTeamSection({ leagueSlug, onChanged }: { leagueSlug: string; onChanged?: () => void }) {
  const q = `league=${encodeURIComponent(leagueSlug)}`;
  const [view, setView] = useState<SetupView | null>(null);
  const [changing, setChanging] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const res = await fetch(`/api/team/setup?${q}`, { cache: "no-store" });
    if (res.ok) setView(await res.json());
  };

  useEffect(() => {
    void load();
    // load only depends on the league.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueSlug]);

  if (!view?.mySlot) return null;
  const current = view.mySlot;
  const saved = view.fplTeams.find((t) => t.fplEntryId === current.fplId);

  const startChange = () => {
    setPicked(current.fplId);
    setNotice(null);
    setChanging(true);
  };

  const save = async () => {
    if (!picked || picked === current.fplId) return setChanging(false);
    setBusy(true);
    setNotice(null);
    const res = await fetch(`/api/team/fpl-team?${q}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fplId: picked }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice({ ok: false, text: body.error ?? "Couldn't switch." });
    setChanging(false);
    setNotice({ ok: true, text: "Switched." });
    await load();
    onChanged?.();
  };

  return (
    <section aria-labelledby="my-fpl-team" className={CARD}>
      <h2 id="my-fpl-team" className="mb-3 text-lg font-semibold text-white">Your FPL team</h2>
      {!changing ? (
        <>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold text-white">{saved ? fplTeamLabel(saved) : `FPL team ${current.fplId}`}</span>
                {saved?.isPrimary && <PrimaryBadge />}
              </span>
              <span className="block truncate text-xs text-gray-400">ID {current.fplId} · plays as {current.name}</span>
            </span>
            {!view.lock && (
              <button type="button" onClick={startChange} className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10">
                Change
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {view.lock
              ? `Fixed since the GW${view.lock.gw} deadline. Ask your league admin if it needs changing.`
              : "You can switch to another of your FPL teams until the league's first gameweek deadline."}
          </p>
        </>
      ) : (
        <div className="space-y-3">
          <FplTeamPicker
            teams={view.fplTeams}
            selected={picked}
            onSelect={setPicked}
            onAdded={(team) => {
              setView((v) => (v ? { ...v, fplTeams: [...v.fplTeams.filter((t) => t.id !== team.id), team] } : v));
              setPicked(team.fplEntryId);
            }}
          />
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy || !picked} className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setChanging(false)} className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && <p role="status" className={`mt-2 text-sm ${notice.ok ? "text-green-400" : "text-red-300"}`}>{notice.text}</p>}
    </section>
  );
}
