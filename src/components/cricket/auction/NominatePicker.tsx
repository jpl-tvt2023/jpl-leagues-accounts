"use client";

import { useMemo, useState } from "react";
import type { RoomTheme } from "@/components/auction/theme";
import { formatLakhs } from "@/lib/format/currency";
import { ROLES } from "@/lib/sports/cricket/squad-rules";
import type { LeagueView } from "@/lib/sports/cricket/league";
import type { RoomState } from "./useAuctionFeed";
import type { CricketWishlist } from "./useCricketWishlist";
import { PlayerChips } from "./PlayerChips";

export type NomineePick = { kind: "player" | "franchise"; id: number; name: string } | null;

/** Players shown at once; the filters narrow the rest. */
const LIST_CAP = 100;

/**
 * Pick who to nominate — any time, so it's ready when your turn comes — then one Nominate button
 * that works on your turn (or, for the host, on the current nominator's behalf). Players: role pills,
 * an IPL-team filter and a search, best points first, with a wishlist star. Franchises: each
 * unowned one at its current opening price.
 */
export function NominatePicker({
  theme,
  state,
  view,
  mode,
  picked,
  onPick,
  onNominate,
  busy,
  canNominate,
  blockedReason,
  wishlist,
  error,
}: {
  theme: RoomTheme;
  state: RoomState;
  view: LeagueView;
  mode: "team" | "admin";
  picked: NomineePick;
  onPick: (pick: NomineePick) => void;
  onNominate: () => void;
  busy: boolean;
  canNominate: boolean;
  /** Why Nominate is off (not your turn, a lot is open, …). */
  blockedReason: string | null;
  wishlist?: CricketWishlist;
  error?: string | null;
}) {
  const [role, setRole] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [q, setQ] = useState("");
  const cur = state.current;
  const me = state.teams.find((t) => t.id === state.myTeamId) ?? null;
  const maxBid = mode === "team" ? (me?.maxBid ?? 0) : Infinity;
  const onBlock = cur?.lot?.playerId ?? null;
  const code = useMemo(() => new Map(view.realTeams.map((t) => [t.id, t.code])), [view.realTeams]);

  const available = useMemo(() => view.players.filter((p) => !p.ownerTeamId), [view.players]);
  const needle = q.trim().toLowerCase();
  const shown = available
    .filter((p) => (!role || p.role === role) && (!team || String(p.teamId) === team) && (!needle || p.name.toLowerCase().includes(needle)))
    .sort((a, b) => b.points - a.points || b.basePrice - a.basePrice || a.name.localeCompare(b.name));

  const footer = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
      <div className="min-w-0 text-xs text-gray-400">
        {picked ? (
          <>
            Picked: <span className="font-semibold text-white">{picked.name}</span>
          </>
        ) : (
          "Pick one from the list."
        )}
        {blockedReason && <div className="mt-0.5 text-[11px] text-gray-500">{blockedReason}</div>}
      </div>
      <button
        type="button"
        onClick={onNominate}
        disabled={!picked || !canNominate || busy}
        className={`rounded-lg px-5 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${theme.primaryButton}`}
      >
        {busy ? "Nominating…" : mode === "admin" ? "Nominate for them" : "Nominate"}
      </button>
      {error && <p className="w-full text-xs text-red-300">{error}</p>}
    </div>
  );

  if (cur?.type === "franchise") {
    const open = state.franchises.filter((f) => !f.ownerTeamId);
    return (
      <div>
        <p className="mb-2 text-xs text-gray-400">Whoever nominates a franchise opens the bidding at its price.</p>
        <div className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
          {open.map((f) => {
            const tooDear = f.openingPrice > maxBid;
            const selected = picked?.kind === "franchise" && picked.id === f.id;
            return (
              <button
                key={f.id}
                type="button"
                disabled={tooDear}
                title={tooDear ? "More than you can bid" : undefined}
                onClick={() => onPick(selected ? null : { kind: "franchise", id: f.id, name: f.name })}
                aria-pressed={selected}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-40 ${
                  selected ? "border-white/40 bg-white/15" : "border-white/10 hover:bg-white/10"
                }`}
              >
                <span className="text-white">
                  {f.name} <span className="text-xs text-gray-500">{f.code}</span>
                </span>
                <span className="whitespace-nowrap pl-2 font-mono text-xs text-gray-300">{formatLakhs(f.openingPrice)}</span>
              </button>
            );
          })}
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {["", ...ROLES].map((r) => (
          <button
            key={r || "all"}
            type="button"
            onClick={() => setRole(r)}
            aria-pressed={role === r}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${role === r ? "border-white/40 bg-white/15 text-white" : "border-white/10 text-gray-400 hover:text-white"}`}
          >
            {r || "All"}
          </button>
        ))}
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="IPL team" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white">
          <option value="">All teams</option>
          {view.realTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" className="min-w-[8rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1 text-xs text-white" />
      </div>
      <div className="mb-1 text-[10px] text-gray-500">
        {shown.length} of {available.length} still available{shown.length > LIST_CAP && ` · showing the first ${LIST_CAP}`}
      </div>
      <ul className="max-h-72 divide-y divide-white/5 overflow-y-auto rounded-lg border border-white/10 text-xs">
        {shown.slice(0, LIST_CAP).map((p) => {
          const tooDear = p.basePrice > maxBid;
          const selected = picked?.kind === "player" && picked.id === p.id;
          const starred = wishlist?.has(p.id) ?? false;
          return (
            <li key={p.id} className={`flex items-center gap-2 px-2 py-1.5 ${selected ? "bg-white/10" : ""}`}>
              <button
                type="button"
                disabled={tooDear || onBlock === p.id}
                title={tooDear ? "More than you can bid" : undefined}
                onClick={() => onPick(selected ? null : { kind: "player", id: p.id, name: p.name })}
                aria-pressed={selected}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:opacity-40"
              >
                <PlayerChips role={p.role} teamCode={code.get(p.teamId)} overseas={p.overseas} />
                <span className="truncate text-white">{p.name}</span>
                {onBlock === p.id && <span className={`text-[10px] font-semibold ${theme.accentText}`}>On block</span>}
                <span className="ml-auto whitespace-nowrap font-mono text-gray-400">{formatLakhs(p.basePrice)}</span>
              </button>
              {wishlist && (
                <button
                  type="button"
                  onClick={() => wishlist.toggle(p.id)}
                  aria-label={starred ? `Remove ${p.name} from your wishlist` : `Add ${p.name} to your wishlist`}
                  className={`px-1 text-sm ${starred ? "text-yellow-300" : "text-gray-500 hover:text-white"}`}
                >
                  {starred ? "★" : "☆"}
                </button>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-3 py-3 text-center text-gray-500">No player matches.</li>}
      </ul>
      {footer}
    </div>
  );
}
