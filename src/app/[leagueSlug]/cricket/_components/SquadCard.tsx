"use client";

import { formatLakhs } from "@/lib/format/currency";
import { ROLES } from "@/lib/sports/cricket/squad-rules";
import type { ViewTeam } from "@/lib/sports/cricket/league";
import type { StandingRow } from "@/lib/sports/cricket/scoring";
import type { CricketLeaguePayload } from "./useCricketLeague";
import { Card } from "./CricketShell";
import { indexView, pts, ROLE_STYLE } from "./view-helpers";

/** One team's squad: franchise, money, role counts against the rules, and every player's points. */
export function SquadCard({ data, team, row, highlight }: { data: CricketLeaguePayload; team: ViewTeam; row?: StandingRow; highlight?: boolean }) {
  const idx = indexView(data);
  const rules = data.config.squadRules;
  const scoreById = new Map((row?.players ?? []).map((p) => [p.playerId, p]));
  const squad = data.players
    .filter((p) => p.ownerTeamId === team.id)
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (scoreById.get(b.id)?.total ?? 0) - (scoreById.get(a.id)?.total ?? 0));
  const cap = rules.maxSize - team.penaltySlots;

  return (
    <Card className={highlight ? "border-green-400/40" : ""}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">{team.name}</h2>
          <p className="text-xs text-gray-400">
            {team.franchise ? <>Franchise: {team.franchise.code} ({formatLakhs(team.franchise.price)}) · {team.ownName}</> : "No franchise"}
          </p>
        </div>
        <div className="text-right text-sm">
          {row && <div className="font-bold text-white">{pts(row.total)} pts</div>}
          <div className="text-xs text-gray-400">
            {formatLakhs(team.purse)} left · spent {formatLakhs(team.spent)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 ${team.squadSize >= rules.minSize ? "bg-green-500/20 text-green-200" : "bg-white/10 text-gray-300"}`}>
          {team.squadSize} / {rules.minSize}–{cap} players
        </span>
        {ROLES.map((r) => {
          const n = team.roleCounts[r];
          const ok = n >= rules.roleMin[r] && (rules.roleMax[r] === null || n <= rules.roleMax[r]!);
          return (
            <span key={r} className={`rounded-full px-2 py-0.5 ${ok ? "bg-white/10 text-gray-200" : "bg-amber-500/20 text-amber-200"}`}>
              {r} {n}
              {rules.roleMin[r] > 0 && `/${rules.roleMin[r]}+`}
            </span>
          );
        })}
        {rules.maxOverseas !== null && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-gray-200">
            ✈ {team.overseasCount}/{rules.maxOverseas}
          </span>
        )}
        {team.penaltySlots > 0 && <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-red-200">{team.penaltySlots} penalty slot(s)</span>}
      </div>
      {squad.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No players yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5 text-sm">
          {squad.map((p) => {
            const s = scoreById.get(p.id);
            return (
              <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="flex items-center gap-2">
                  <span className={`rounded px-1.5 text-[10px] font-semibold ${ROLE_STYLE[p.role]}`}>{p.role}</span>
                  <span className="text-white">{p.name}</span>
                  <span className="text-xs text-gray-500">{idx.realTeam.get(p.teamId)?.code}</span>
                  {p.overseas && <span className="text-xs text-sky-300">✈</span>}
                  {s?.boosted && <span className="text-xs text-green-300">★</span>}
                </span>
                <span className="text-right text-gray-300">
                  {pts(s?.total ?? 0)} <span className="text-xs text-gray-500">· {formatLakhs(p.price ?? 0)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
