"use client";

import { useState } from "react";
import { formatLakhs } from "@/lib/format/currency";
import type { LeagueView } from "@/lib/sports/cricket/league";
import type { CricketWishlist } from "./useCricketWishlist";
import { PlayerChips } from "./PlayerChips";

/**
 * Your wishlist, in priority order: add players by search, reorder or remove them. If your
 * nomination timer runs out, the first one you can still buy is nominated for you.
 */
export function WishlistTab({ view, wishlist }: { view: LeagueView; wishlist: CricketWishlist }) {
  const [q, setQ] = useState("");
  const code = (id: number) => view.realTeams.find((t) => t.id === id)?.code;
  const needle = q.trim().toLowerCase();
  const matches = needle ? view.players.filter((p) => !p.ownerTeamId && !wishlist.has(p.id) && p.name.toLowerCase().includes(needle)).slice(0, 8) : [];
  const ids = wishlist.ids;

  return (
    <div>
      <p className="mb-2 text-xs text-gray-400">If you miss your turn, the first player here you can still buy is nominated for you.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a player…" aria-label="Add a player to your wishlist" className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white" />
      {matches.length > 0 && (
        <ul className="mt-1 divide-y divide-white/5 rounded-lg border border-white/10 text-xs">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  wishlist.toggle(p.id);
                  setQ("");
                }}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-white/10"
              >
                <PlayerChips role={p.role} teamCode={code(p.teamId)} overseas={p.overseas} />
                <span className="text-white">{p.name}</span>
                <span className="ml-auto font-mono text-gray-400">{formatLakhs(p.basePrice)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ids === null ? (
        <p className="mt-3 text-sm text-gray-400">Loading…</p>
      ) : ids.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">Empty — add players, or star them in the Nominate list.</p>
      ) : (
        <ol className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
          {ids.map((id, i) => {
            const p = view.players.find((x) => x.id === id);
            if (!p) return null;
            const sold = !!p.ownerTeamId;
            return (
              <li key={id} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 ${sold ? "opacity-40" : "bg-white/5"}`}>
                <span className="w-5 text-right text-gray-500">{i + 1}</span>
                <PlayerChips role={p.role} teamCode={code(p.teamId)} overseas={p.overseas} />
                <span className={`truncate ${sold ? "text-gray-400 line-through" : "text-white"}`}>{p.name}</span>
                <span className="ml-auto flex items-center gap-1 text-gray-400">
                  <button type="button" aria-label={`Move ${p.name} up`} onClick={() => wishlist.move(i, -1)} className="px-1 hover:text-white">
                    ↑
                  </button>
                  <button type="button" aria-label={`Move ${p.name} down`} onClick={() => wishlist.move(i, 1)} className="px-1 hover:text-white">
                    ↓
                  </button>
                  <button type="button" aria-label={`Remove ${p.name}`} onClick={() => wishlist.remove(id)} className="px-1 hover:text-red-300">
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {wishlist.saving && <p className="mt-2 text-[11px] text-gray-500">Saving…</p>}
      {wishlist.error && <p className="mt-2 text-xs text-red-300">{wishlist.error}</p>}
    </div>
  );
}
