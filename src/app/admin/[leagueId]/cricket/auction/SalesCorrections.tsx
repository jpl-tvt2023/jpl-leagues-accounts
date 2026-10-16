"use client";

import { useState } from "react";
import { formatLakhs } from "@/lib/format/currency";
import type { FeedLot } from "@/lib/sports/cricket/auction/feed";

type Act = (body: Record<string, unknown>, confirmText?: string) => Promise<boolean>;

/**
 * Every sale of the auction, newest first, with Undo (it's unsold again, the money goes back) and
 * Move (to another team, at the same or a new price, checked like a purchase). Both stop once the
 * player auction is complete.
 */
export function SalesCorrections({
  groups,
  teams,
  nameOf,
  busy,
  act,
  final,
}: {
  groups: Array<{ title: string; lots: FeedLot[] }>;
  teams: Array<{ id: string; name: string }>;
  nameOf: (teamId: string | null | undefined) => string;
  busy: boolean;
  act: Act;
  /** Squads are final: no more corrections. */
  final: boolean;
}) {
  const [moving, setMoving] = useState<{ lotId: string; toTeamId: string; price: string } | null>(null);
  const total = groups.reduce((n, g) => n + g.lots.length, 0);
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-white">Sales</h3>
      {total === 0 ? (
        <p className="text-sm text-gray-400">Nothing sold yet.</p>
      ) : (
        <>
          <p className="text-xs text-gray-400">{final ? "The player auction is complete — squads are final." : "Undo makes a lot unsold again. Move gives it to another team, refunding the first."}</p>
          {groups
            .filter((g) => g.lots.length > 0)
            .map((g) => (
              <div key={g.title} className="mt-3">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-gray-500">{g.title}</div>
                <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto text-sm">
                  {g.lots.map((s) => (
                    <li key={s.id} className="py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-200">
                          {s.lotNumber != null && <span className="mr-1 text-xs text-gray-500">#{s.lotNumber}</span>}
                          {s.name} → {nameOf(s.teamId)} · <span className="font-mono">{formatLakhs(s.price)}</span>
                        </span>
                        {!final && (
                          <span className="flex gap-3">
                            <button
                              type="button"
                              disabled={busy}
                              className="text-xs text-green-300 hover:underline disabled:opacity-40"
                              onClick={() => setMoving(moving?.lotId === s.id ? null : { lotId: s.id, toTeamId: "", price: String(s.price) })}
                            >
                              Move
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              className="text-xs text-red-300 hover:underline disabled:opacity-40"
                              onClick={() => act({ action: "undo-sale", lotId: s.id }, `Undo the sale of ${s.name}? The money goes back and it's unsold again.`)}
                            >
                              Undo
                            </button>
                          </span>
                        )}
                      </div>
                      {moving?.lotId === s.id && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <label className="text-xs text-gray-400">
                            To
                            <select
                              value={moving.toTeamId}
                              onChange={(e) => setMoving({ ...moving, toTeamId: e.target.value })}
                              className="mt-1 block rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
                            >
                              <option value="">Choose a team</option>
                              {teams
                                .filter((t) => t.id !== s.teamId)
                                .map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="text-xs text-gray-400">
                            Price (lakhs)
                            <input
                              type="number"
                              min={0}
                              step={5}
                              value={moving.price}
                              onChange={(e) => setMoving({ ...moving, price: e.target.value })}
                              className="mt-1 block w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={busy || !moving.toTeamId || moving.price === ""}
                            className="rounded-lg bg-green-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-40"
                            onClick={async () => {
                              const price = Number(moving.price);
                              const ok = await act(
                                { action: "transfer-sale", lotId: s.id, toTeamId: moving.toTeamId, price },
                                `Move ${s.name} to ${nameOf(moving.toTeamId)} for ${formatLakhs(price)}? ${nameOf(s.teamId)} gets ${formatLakhs(s.price)} back.`,
                              );
                              if (ok) setMoving(null);
                            }}
                          >
                            Move
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
