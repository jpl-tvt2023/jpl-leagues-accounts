"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatLakhs } from "@/lib/format/currency";
import { formatIst } from "@/lib/sports/cricket/sheets/ist";
import type { AuctionSnapshot } from "@/lib/sports/cricket/auction/snapshot";

type AdminState = AuctionSnapshot & {
  events: Array<{ id: string; event: string; teamId: string | null; actor: string; detail: string | null; createdAt: string }>;
  short: Array<{ teamId: string; name: string; needed: number }>;
};

const TYPE = { franchise: "Franchise auction", player: "Player auction" } as const;
const btn = "rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-40";
const primary = "rounded-lg bg-green-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-40";

/** Running a cricket league's auction: sessions, the live lot, turns and corrections. */
export function CricketAuctionAdmin({
  leagueId,
  leagueSlug,
  franchiseEnabled,
  isSuperadmin,
  onChanged,
}: {
  leagueId: string;
  leagueSlug: string;
  franchiseEnabled: boolean;
  isSuperadmin: boolean;
  onChanged: () => void;
}) {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [scheduleAt, setScheduleAt] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`/api/admin/${leagueId}/cricket/auction`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (res.ok) setState(body);
      else setError(body.error ?? "Couldn't load the auction");
    };
    const first = setTimeout(load, 0);
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [leagueId, version]);

  const act = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${leagueId}/cricket/auction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Completing with short squads: offer to force it.
        if (body.action === "complete" && res.status === 409 && /short of a full squad/.test(out.error ?? "")) {
          if (confirm(`${out.error}\n\nComplete anyway? Squads are then final.`)) {
            await act({ ...body, force: true });
          }
          return;
        }
        setError(out.error ?? "That didn't work");
      }
      setVersion((v) => v + 1);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <p className="text-sm text-gray-400">{error ?? "Loading…"}</p>;
  const name = (id: string | null | undefined) => state.teams.find((t) => t.id === id)?.name ?? "—";
  const cur = state.current;
  const hasFranchise = state.sessions.some((s) => s.type === "franchise");
  const hasPlayer = state.sessions.some((s) => s.type === "player");
  const started = state.sessions.some((s) => s.status !== "pending");

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-white">Sessions</h2>
          <Link href={`/${leagueSlug}/cricket/auction`} className="text-sm text-green-300 hover:underline">
            Open the auction room →
          </Link>
        </div>
        {state.sessions.length === 0 && <p className="mt-2 text-sm text-gray-400">No sessions yet.</p>}
        <ul className="mt-3 space-y-3">
          {state.sessions.map((s) => (
            <li key={s.id} className="rounded-xl border border-white/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-white">
                  <span className="font-semibold">{TYPE[s.type]}</span> · {s.status}
                  {s.scheduledAt && <span className="text-gray-400"> · {formatIst(new Date(s.scheduledAt))} IST</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  {s.status === "pending" && (
                    <>
                      <button type="button" disabled={busy} className={primary} onClick={() => act({ action: "start", sessionId: s.id }, `Start the ${TYPE[s.type].toLowerCase()} now?`)}>
                        Start
                      </button>
                      <button type="button" disabled={busy || !scheduleAt} className={btn} onClick={() => act({ action: "schedule", sessionId: s.id, scheduledAt: new Date(scheduleAt).toISOString() })}>
                        Set time
                      </button>
                      <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "delete", sessionId: s.id }, "Delete this session?")}>
                        Delete
                      </button>
                    </>
                  )}
                  {s.status === "active" && (
                    <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "pause", sessionId: s.id })}>
                      Pause
                    </button>
                  )}
                  {s.status === "paused" && (
                    <button type="button" disabled={busy} className={primary} onClick={() => act({ action: "resume", sessionId: s.id })}>
                      Resume
                    </button>
                  )}
                  {(s.status === "active" || s.status === "paused") && (
                    <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "complete", sessionId: s.id }, `Finish the ${TYPE[s.type].toLowerCase()}?`)}>
                      Complete
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-400">
            Start time (your local time)
            <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white" />
          </label>
          {franchiseEnabled && !hasFranchise && (
            <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "create", type: "franchise", scheduledAt: scheduleAt ? new Date(scheduleAt).toISOString() : null })}>
              + Franchise auction
            </button>
          )}
          {!hasPlayer && (
            <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "create", type: "player", scheduledAt: scheduleAt ? new Date(scheduleAt).toISOString() : null })}>
              + Player auction
            </button>
          )}
        </div>
      </section>

      {cur && (cur.status === "active" || cur.status === "paused") && (
        <section className="rounded-2xl border border-green-400/30 bg-white/5 p-5">
          <h2 className="font-semibold text-white">Live: {TYPE[cur.type]}</h2>
          {cur.lot ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-200">
              <span>
                Lot {cur.lot.lotNumber}: <span className="font-semibold text-white">{cur.lot.name}</span> · {formatLakhs(cur.lot.currentHighBid)} by {name(cur.lot.currentHighBidderId)}
              </span>
              <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "cancel-lot", sessionId: cur.sessionId }, "Withdraw this lot without a sale? The same team nominates again.")}>
                Cancel lot
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-300">
              {cur.intermissionUntil ? "Between lots." : `${name(cur.nominatorTeamId)} to nominate${cur.nominationDeadline ? ` (until ${formatIst(new Date(cur.nominationDeadline)).slice(11)})` : ""}.`}
            </p>
          )}
          <ul className="mt-3 divide-y divide-white/5 text-sm">
            {cur.ring.map((teamId, i) => {
              const t = state.teams.find((x) => x.id === teamId);
              return (
                <li key={teamId} className={`flex items-center justify-between gap-2 py-1.5 ${i === cur.currentNominatorIndex ? "text-green-200" : "text-gray-300"}`}>
                  <span>
                    {i + 1}. {name(teamId)}
                    {cur.makeupQueue.includes(teamId) && <span className="ml-1 text-xs text-amber-300">(make-up turn owed)</span>}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-gray-400">
                    {t && `${formatLakhs(t.purse)} · ${t.squadSize}/${t.cap}${t.penaltySlots ? ` · ${t.penaltySlots} penalty` : ""}`}
                    <button type="button" disabled={busy} className="text-green-300 hover:underline disabled:opacity-40" onClick={() => act({ action: "grant-turn", sessionId: cur.sessionId, teamId })}>
                      Give a turn
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {cur.type === "player" && state.short.length > 0 && (
            <p className="mt-3 text-xs text-amber-200">Still short of a full squad: {state.short.map((s) => `${s.name} (${s.needed})`).join(", ")}</p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="font-semibold text-white">Sales</h2>
        {state.sales.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">Nothing sold yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/5 text-sm">
            {state.sales.map((s) => (
              <li key={s.lotId} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-gray-200">
                  {s.name} → {name(s.teamId)} · {formatLakhs(s.price)}
                </span>
                <button type="button" disabled={busy} className="text-xs text-red-300 hover:underline disabled:opacity-40" onClick={() => act({ action: "undo-sale", lotId: s.lotId }, `Undo the sale of ${s.name}? The money goes back and it's unsold again.`)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {state.events.length > 0 && (
        <details className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm">
          <summary className="cursor-pointer font-semibold text-white">Turn log</summary>
          <ul className="mt-2 space-y-1 text-xs text-gray-400">
            {state.events.map((e) => (
              <li key={e.id}>
                {new Date(e.createdAt).toLocaleTimeString("en-IN")} · {e.event}
                {e.teamId && ` · ${name(e.teamId)}`} · {e.actor}
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h2 className="font-semibold text-white">Start over</h2>
        <p className="mt-1 text-xs text-gray-400">Deletes every session, sale, franchise and penalty and restores every purse. Wishlists stay.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-40"
            onClick={() => {
              const typed = prompt(`Type the league slug (${leagueSlug}) to reset the whole auction:`);
              if (typed === leagueSlug) void act({ action: "reset" });
            }}
          >
            Reset auction
          </button>
          {isSuperadmin && !started && (
            <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "simulate" }, "Simulate both auctions instantly (rehearsals and testing)?")}>
              Simulate auction
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
