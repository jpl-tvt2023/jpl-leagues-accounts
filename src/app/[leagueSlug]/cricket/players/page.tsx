"use client";

import { useMemo, useState } from "react";
import { useLeague } from "@/lib/league-context";
import { formatLakhs } from "@/lib/format/currency";
import { ROLES, ROLE_LABELS } from "@/lib/sports/cricket/squad-rules";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { indexView, pts, ROLE_STYLE } from "../_components/view-helpers";
import { PLAYOFFS_FOOTNOTE, t20MatchesLabel } from "@/lib/sports/cricket/match-counts";

type Sort = "points" | "price" | "name";
type Status = "all" | "available" | "sold";

const select = "rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white";

export default function CricketPlayerPoolPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug);
  const idx = useMemo(() => (data ? indexView(data) : null), [data]);
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [overseasOnly, setOverseasOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("points");

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.players
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .filter((p) => !team || String(p.teamId) === team)
      .filter((p) => !role || p.role === role)
      .filter((p) => status === "all" || (status === "sold" ? p.ownerTeamId : !p.ownerTeamId))
      .filter((p) => !overseasOnly || p.overseas)
      .sort((a, b) =>
        sort === "name" ? a.name.localeCompare(b.name) : sort === "price" ? b.basePrice - a.basePrice || a.name.localeCompare(b.name) : b.points - a.points || b.basePrice - a.basePrice,
      );
  }, [data, q, team, role, status, overseasOnly, sort]);

  const showFormats = !!data && data.players.some((p) => p.matchesTest || p.matchesOdi);

  return (
    <CricketShell
      currentPage="players"
      title="Player pool"
      subtitle={data && `${data.players.length} players · ${data.players.filter((p) => p.ownerTeamId).length} sold`}
      loading={!data}
      error={error}
      wide
    >
      {data && idx && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" className={`${select} min-w-[12rem] flex-1`} />
            <select value={team} onChange={(e) => setTeam(e.target.value)} className={select} aria-label="Team">
              <option value="">All teams</option>
              {data.realTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={select} aria-label="Role">
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={select} aria-label="Status">
              <option value="all">Sold and unsold</option>
              <option value="available">Unsold</option>
              <option value="sold">Sold</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={select} aria-label="Sort">
              <option value="points">Most points</option>
              <option value="price">Highest base price</option>
              <option value="name">Name</option>
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={overseasOnly} onChange={(e) => setOverseasOnly(e.target.checked)} className="accent-green-400" />
              Overseas only
            </label>
          </div>
          <Card className="overflow-x-auto p-0 sm:p-0">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-400">
                <tr className="border-b border-white/10">
                  <th className="px-3 py-3">Player</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3 text-right">Base</th>
                  <th className="px-3 py-3 text-right">{showFormats ? "Test / ODI / T20" : "Matches"}</th>
                  <th className="px-3 py-3 text-right">Points</th>
                  <th className="px-3 py-3">Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const owner = p.ownerTeamId ? idx.team.get(p.ownerTeamId) : undefined;
                  return (
                    <tr key={p.id} className={`border-b border-white/5 ${p.ownerTeamId && p.ownerTeamId === data.myTeamId ? "bg-green-500/10" : ""}`}>
                      <td className="px-3 py-2">
                        <span className="text-white">{p.name}</span>
                        <span className="ml-2 text-xs text-gray-500">{idx.realTeam.get(p.teamId)?.code}</span>
                        {p.overseas && <span className="ml-1 text-xs text-sky-300">✈</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${ROLE_STYLE[p.role]}`}>{p.role}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-300">{formatLakhs(p.basePrice)}</td>
                      <td className="px-3 py-2 text-right text-gray-400">
                        {(() => {
                          // Group-stage count, plus the team's playoff matches (or "playoffs*" until they're uploaded).
                          const t20 = t20MatchesLabel(p.matchesT20, data.playoffs, idx.realTeam.get(p.teamId)?.playoffMatches ?? 0);
                          return showFormats ? `${p.matchesTest} / ${p.matchesOdi} / ${t20}` : t20;
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-white">
                        {pts(p.points)} <span className="text-xs font-normal text-gray-500">({p.matches})</span>
                      </td>
                      <td className="px-3 py-2 text-gray-300">
                        {owner ? (
                          <>
                            {owner.name} <span className="text-xs text-gray-500">{formatLakhs(p.price ?? 0)}</span>
                          </>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="px-4 py-6 text-sm text-gray-400">No players match.</p>}
            {data.playoffs === "pending" && rows.length > 0 && <p className="px-4 py-3 text-xs text-gray-500">{PLAYOFFS_FOOTNOTE}</p>}
          </Card>
        </>
      )}
    </CricketShell>
  );
}
