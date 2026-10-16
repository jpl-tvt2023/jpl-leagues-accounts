"use client";

import { useState } from "react";
import type { RoomTheme } from "@/components/auction/theme";
import { NominatePicker, type NomineePick } from "@/components/cricket/auction/NominatePicker";
import type { RoomState } from "@/components/cricket/auction/useAuctionFeed";
import type { LeagueView } from "@/lib/sports/cricket/league";

export interface TurnEvent {
  id: string;
  event: string;
  teamId: string | null;
  actor: string;
  createdAt: string;
}

type Act = (body: Record<string, unknown>, confirmText?: string) => Promise<boolean>;

const EVENT_CLASS: Record<string, string> = {
  penalised: "text-red-300",
  skipped: "text-amber-300",
  nominated: "text-green-300",
  "auto-nominated": "text-green-300",
  paused: "text-yellow-300",
  resumed: "text-yellow-300",
  completed: "text-white",
};

const btn = "rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/10 disabled:opacity-40";

/**
 * The host's "correct turn" panel: cancel the open lot, owe a team a turn (next, or at the back of
 * the queue) or take one back, move whose turn it is (paused only), nominate for the current
 * nominator, and the turn log.
 */
export function TurnCorrections({
  theme,
  state,
  view,
  events,
  nameOf,
  busy,
  act,
  picked,
  onPick,
}: {
  theme: RoomTheme;
  state: RoomState;
  view: LeagueView | null;
  events: TurnEvent[];
  nameOf: (teamId: string | null | undefined) => string;
  busy: boolean;
  act: Act;
  picked: NomineePick;
  onPick: (pick: NomineePick) => void;
}) {
  const cur = state.current!;
  const sessionId = cur.sessionId;
  const paused = cur.status === "paused";
  const [owe, setOwe] = useState("");
  const [setTo, setSetTo] = useState("");
  const ring = cur.ring;
  const returnTo = cur.ringReturnIndex != null ? ring[(cur.ringReturnIndex + 1) % ring.length] : null;
  const canNominate = cur.status === "active" && !cur.lot && !cur.intermissionUntil && !!cur.nominationDeadline;
  const blockedReason =
    cur.status !== "active" ? "Only while the auction runs." : cur.lot ? "A lot is open." : cur.intermissionUntil ? "Between lots — the next turn opens in a moment." : !cur.nominationDeadline ? "Waiting for the next turn to open." : null;

  const nominate = async () => {
    if (!picked) return;
    const ok = await act({ action: "nominate", sessionId, ...(picked.kind === "player" ? { playerId: picked.id } : { cricketTeamId: picked.id }) });
    if (ok) onPick(null);
  };

  return (
    <details open className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-wider text-white">Correct turn</summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-300">
              Now:{" "}
              <span className={`font-semibold ${theme.accentText}`}>
                {cur.lot ? `lot open — ${cur.lot.name}` : cur.nominatorTeamId ? `${nameOf(cur.nominatorTeamId)} to nominate` : "nobody"}
              </span>
            </span>
            {cur.status === "active" && (
              <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "pause", sessionId })}>
                Pause &amp; correct
              </button>
            )}
            {cur.lot && (
              <button type="button" disabled={busy} className={btn} onClick={() => act({ action: "cancel-lot", sessionId }, "Withdraw this lot without a sale? The same team nominates again.")}>
                Cancel lot
              </button>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs text-gray-400">Whose turn {paused ? "" : "(pause first)"}</div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !paused || !!cur.lot} className={btn} onClick={() => act({ action: "set-nominator", sessionId, direction: "back" })}>
                ← Back one
              </button>
              <button type="button" disabled={busy || !paused || !!cur.lot} className={btn} onClick={() => act({ action: "set-nominator", sessionId, direction: "forward" })}>
                Forward one →
              </button>
              <select value={setTo} onChange={(e) => setSetTo(e.target.value)} aria-label="Team to nominate next" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white">
                <option value="">Choose a team</option>
                {ring.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy || !paused || !!cur.lot || !setTo} className={btn} onClick={() => act({ action: "set-nominator", sessionId, teamId: setTo })}>
                Set
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-gray-400">Owe a team a turn</div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={owe} onChange={(e) => setOwe(e.target.value)} aria-label="Team owed a turn" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white">
                <option value="">Choose a team</option>
                {ring.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy || !owe} className={btn} onClick={() => act({ action: "grant-turn", sessionId, teamId: owe, position: "front" })}>
                Next
              </button>
              <button type="button" disabled={busy || !owe} className={btn} onClick={() => act({ action: "grant-turn", sessionId, teamId: owe, position: "back" })}>
                Queue
              </button>
            </div>
            {cur.makeupQueue.length > 0 && (
              <ol className="mt-2 space-y-1 text-xs">
                {cur.makeupQueue.map((id, i) => (
                  <li key={`${id}-${i}`} className="flex items-center gap-2 text-sky-200">
                    {i + 1}. {nameOf(id)}
                    <button type="button" disabled={busy} className="text-gray-400 hover:text-red-300" onClick={() => act({ action: "dequeue-makeup", sessionId, index: i })}>
                      remove
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {returnTo && <p className="mt-1 text-[11px] text-gray-500">After the owed turns, the ring carries on with {nameOf(returnTo)}.</p>}
          </div>

          {events.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-gray-400">Turn log</div>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[11px] text-gray-400">
                {events.map((e) => (
                  <li key={e.id} className={EVENT_CLASS[e.event] ?? (e.actor === "admin" ? "text-sky-200" : "")}>
                    {new Date(e.createdAt).toLocaleTimeString("en-IN")} · {e.event}
                    {e.teamId && ` · ${nameOf(e.teamId)}`} · {e.actor}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {view && (
          <div>
            <div className="mb-1 text-xs text-gray-400">Nominate for {cur.nominatorTeamId ? nameOf(cur.nominatorTeamId) : "the current nominator"}</div>
            <NominatePicker theme={theme} state={state} view={view} mode="admin" picked={picked} onPick={onPick} onNominate={nominate} busy={busy} canNominate={canNominate} blockedReason={blockedReason} />
          </div>
        )}
      </div>
    </details>
  );
}
