"use client";

import { useEffect, useMemo, useState } from "react";
import { formatLakhs } from "@/lib/format/currency";
import type { LeagueView } from "@/lib/sports/cricket/league";
import { Card } from "../_components/CricketShell";
import { indexView, ROLE_STYLE } from "../_components/view-helpers";

/**
 * Your wishlist: if your nomination timer runs out in the player auction, the first player on it
 * you can still buy is nominated for you (with nothing usable on it you get a penalty slot).
 */
export function WishlistPanel({ slug, view }: { slug: string; view: LeagueView }) {
  const [ids, setIds] = useState<number[] | null>(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const idx = useMemo(() => indexView(view), [view]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/cricket/auction/wishlist?league=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!cancelled) setIds(res.ok ? body.playerIds : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const save = async (next: number[]) => {
    setIds(next);
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/cricket/auction/wishlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ league: slug, playerIds: next }),
    });
    setSaving(false);
    if (!res.ok) setMsg("Couldn't save your wishlist");
  };

  const move = (i: number, d: -1 | 1) => {
    if (!ids) return;
    const next = [...ids];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void save(next);
  };

  const needle = q.trim().toLowerCase();
  const matches = needle
    ? view.players.filter((p) => !p.ownerTeamId && !ids?.includes(p.id) && p.name.toLowerCase().includes(needle)).slice(0, 8)
    : [];

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Wishlist</h2>
        {saving && <span className="text-xs text-gray-400">Saving…</span>}
      </div>
      <p className="mt-1 text-xs text-gray-400">If you miss your turn, the first player here you can still buy is nominated for you.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a player…" className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" />
      {matches.length > 0 && (
        <ul className="mt-1 divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  void save([...(ids ?? []), p.id]);
                  setQ("");
                }}
                className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-white/10"
              >
                <span className="text-white">
                  {p.name} <span className="text-xs text-gray-500">{idx.realTeam.get(p.teamId)?.code}</span>
                </span>
                <span className="text-gray-400">{formatLakhs(p.basePrice)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ids === null ? (
        <p className="mt-3 text-sm text-gray-400">Loading…</p>
      ) : ids.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">Empty.</p>
      ) : (
        <ol className="mt-3 space-y-1 text-sm">
          {ids.map((id, i) => {
            const p = idx.player.get(id);
            if (!p) return null;
            const sold = !!p.ownerTeamId;
            return (
              <li key={id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${sold ? "opacity-40" : "bg-white/5"}`}>
                <span className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs text-gray-500">{i + 1}</span>
                  <span className={`rounded px-1.5 text-[10px] font-semibold ${ROLE_STYLE[p.role]}`}>{p.role}</span>
                  <span className={sold ? "text-gray-400 line-through" : "text-white"}>{p.name}</span>
                </span>
                <span className="flex items-center gap-1 text-gray-400">
                  <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="px-1 hover:text-white">
                    ↑
                  </button>
                  <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="px-1 hover:text-white">
                    ↓
                  </button>
                  <button type="button" aria-label="Remove" onClick={() => save(ids.filter((x) => x !== id))} className="px-1 hover:text-red-300">
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {msg && <p className="mt-2 text-xs text-red-300">{msg}</p>}
    </Card>
  );
}
