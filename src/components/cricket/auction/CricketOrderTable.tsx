"use client";

import { useState } from "react";
import { OrderTable, type OrderRow } from "@/components/auction/OrderTable";
import type { RoomTheme } from "@/components/auction/theme";
import { formatLakhs } from "@/lib/format/currency";
import { ROLES } from "@/lib/sports/cricket/squad-rules";
import type { LeagueView } from "@/lib/sports/cricket/league";
import type { RoomState } from "./useAuctionFeed";
import { PlayerChips } from "./PlayerChips";

/**
 * The cricket room's nomination order and squad board: ring order, purses, WK / BAT / AR / BOWL
 * counts against the league's minimums, owned franchise, penalty slots and owed make-up turns; a row
 * opens to the team's squad by role.
 */
export function CricketOrderTable({ theme, state, view }: { theme: RoomTheme; state: RoomState; view: LeagueView | null }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const cur = state.current;
  const running = !!cur && (cur.status === "active" || cur.status === "paused");
  const rules = view?.config.squadRules;
  const owed = cur?.makeupQueue ?? [];
  const code = new Map(view?.realTeams.map((t) => [t.id, t.code]) ?? []);

  const rows: OrderRow[] = state.teams.map((t) => {
    const franchise = t.franchiseId !== null ? state.franchises.find((f) => f.id === t.franchiseId) : undefined;
    const squad = view?.players.filter((p) => p.ownerTeamId === t.id) ?? [];
    const owedTurns = owed.filter((id) => id === t.id).length;
    return {
      id: t.id,
      name: t.displayName,
      isCurrent: running && cur!.nominatorTeamId === t.id && !cur!.lot,
      isMe: t.id === state.myTeamId,
      purse: formatLakhs(t.purse),
      categories: ROLES.map((r) => ({ count: t.roleCounts[r], min: rules?.roleMin[r] ?? 0, max: rules?.roleMax[r] ?? null })),
      total: { count: t.squadSize, cap: t.cap },
      badges: (
        <>
          {t.displayName !== t.name && <span className="text-[10px] font-normal text-gray-400">({t.name})</span>}
          {franchise && <span className="rounded border border-green-500/40 bg-green-500/15 px-1 py-0.5 text-[9px] font-bold text-green-200" title={`Owns ${franchise.name}`}>{franchise.code}</span>}
          {rules?.maxOverseas != null && (
            <span className={`text-[9px] ${t.overseas > rules.maxOverseas ? "text-red-300" : "text-sky-300"}`} title="Overseas players / most allowed">
              ✈{t.overseas}/{rules.maxOverseas}
            </span>
          )}
          {t.penaltySlots > 0 && (
            <span title={`${t.penaltySlots} penalty slot${t.penaltySlots === 1 ? "" : "s"} — squad cap reduced`} className="rounded border border-red-500/30 bg-red-500/15 px-1 text-[9px] font-bold text-red-300">
              ✕{t.penaltySlots}
            </span>
          )}
          {owedTurns > 0 && (
            <span title="Owed a make-up turn" className="rounded border border-sky-500/30 bg-sky-500/15 px-1 text-[9px] font-bold text-sky-200">
              +{owedTurns} turn
            </span>
          )}
        </>
      ),
      detail:
        squad.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ROLES.map((role) => {
              const players = squad.filter((p) => p.role === role).sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
              return (
                <div key={role} className="space-y-1">
                  <div className="px-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                    {role} <span className="text-gray-600">({players.length})</span>
                  </div>
                  {players.length === 0 ? (
                    <div className="px-2 py-1 text-[10px] text-gray-600">—</div>
                  ) : (
                    players.map((p) => (
                      <div key={p.id} className="flex items-center gap-1.5 rounded bg-white/5 px-2 py-1 text-[11px]">
                        <span className="flex-1 truncate text-white">{p.name}</span>
                        <PlayerChips teamCode={code.get(p.teamId)} overseas={p.overseas} />
                        <span className="font-mono text-[10px] text-green-400">{formatLakhs(p.price ?? 0)}</span>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        ) : undefined,
    };
  });

  return <OrderTable theme={theme} categoryLabels={[...ROLES]} rows={rows} expandedId={expanded} onToggle={(id) => setExpanded((e) => (e === id ? null : id))} />;
}
