/** Lookups over the cricket league view, shared by the pages. Pure. */

import type { LeagueView, ViewPlayer, ViewTeam } from "@/lib/sports/cricket/league";

export interface ViewIndex {
  realTeam: Map<number, LeagueView["realTeams"][number]>;
  team: Map<string, ViewTeam>;
  player: Map<number, ViewPlayer>;
}

export function indexView(view: LeagueView): ViewIndex {
  return {
    realTeam: new Map(view.realTeams.map((t) => [t.id, t])),
    team: new Map(view.teams.map((t) => [t.id, t])),
    player: new Map(view.players.map((p) => [p.id, p])),
  };
}

/** "54", "12.5", "-3" — points without float noise or a trailing ".0". */
export function pts(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

export const ROLE_STYLE: Record<string, string> = {
  WK: "bg-amber-500/20 text-amber-200",
  BAT: "bg-sky-500/20 text-sky-200",
  AR: "bg-violet-500/20 text-violet-200",
  BOWL: "bg-rose-500/20 text-rose-200",
};
