/**
 * What a finished cricket auction session came to, team by team, from the league view: the players
 * (or the franchise) each team bought and for how much, and the purse it has left. Pure.
 */

import type { CricketRole } from "@/lib/db/schema-cricket";
import type { LeagueView } from "../league";

export interface CricketResultItem {
  id: string;
  name: string;
  price: number;
  role?: CricketRole;
  teamCode?: string;
  overseas?: boolean;
}

export interface CricketResultTeam {
  id: string;
  name: string;
  purseLeft: number;
  countLabel: string;
  note?: string;
  items: CricketResultItem[];
}

export function cricketFinalResults(view: Pick<LeagueView, "teams" | "players" | "realTeams">, type: "franchise" | "player"): CricketResultTeam[] {
  const code = new Map(view.realTeams.map((t) => [t.id, t.code]));
  return view.teams.map((team) => {
    if (type === "franchise") {
      const f = team.franchise;
      return {
        id: team.id,
        name: team.ownName,
        purseLeft: team.purse,
        countLabel: f ? "Franchise" : "No franchise",
        items: f ? [{ id: `f${f.id}`, name: f.name, price: f.price, teamCode: f.code }] : [],
      };
    }
    const items = view.players
      .filter((p) => p.ownerTeamId === team.id)
      .map((p) => ({ id: String(p.id), name: p.name, price: p.price ?? 0, role: p.role, teamCode: code.get(p.teamId), overseas: p.overseas }));
    return {
      id: team.id,
      name: team.name,
      purseLeft: team.purse,
      countLabel: `${items.length} player${items.length === 1 ? "" : "s"}`,
      note: team.franchise ? `${team.ownName} · owns ${team.franchise.name}` : undefined,
      items,
    };
  });
}
