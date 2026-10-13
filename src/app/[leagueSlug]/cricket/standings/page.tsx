"use client";

import { Fragment, useMemo, useState } from "react";
import { useLeague } from "@/lib/league-context";
import { formatLakhs } from "@/lib/format/currency";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { indexView, pts, ROLE_STYLE } from "../_components/view-helpers";

export default function CricketStandingsPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug);
  const [open, setOpen] = useState<string | null>(null);

  const s = data?.standings;
  const idx = useMemo(() => (data ? indexView(data) : null), [data]);
  return (
    <CricketShell
      currentPage="standings"
      title="Standings"
      subtitle={
        data && (
          <>
            {data.tournament.name} · {s!.fixturesScored} of {s!.fixturesTotal} matches scored
            {data.config.franchiseAuctionEnabled && <> · own-franchise players +{data.config.franchiseBoostPercent}%</>}
          </>
        )
      }
      loading={!data}
      error={error}
      wide
    >
      {data && s && (
        <>
          {s.complete && s.rows[0] && (
            <Card className="mb-4 border-yellow-400/40 bg-yellow-400/10">
              <p className="text-sm text-yellow-200">
                🏆 Champions: <span className="font-semibold text-white">{s.rows.filter((r) => r.rank === 1).map((r) => r.name).join(" & ")}</span>
              </p>
            </Card>
          )}
          <Card className="overflow-x-auto p-0 sm:p-0">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-gray-400">
                <tr className="border-b border-white/10">
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">Team</th>
                  <th className="px-3 py-3 text-right">Points</th>
                  {data.config.franchiseAuctionEnabled && <th className="px-3 py-3 text-right">Synergy</th>}
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="hidden px-3 py-3 text-right sm:table-cell">Purse left</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((row) => {
                  const team = idx!.team.get(row.teamId);
                  const mine = row.teamId === data.myTeamId;
                  return (
                    <Fragment key={row.teamId}>
                      <tr
                        onClick={() => setOpen(open === row.teamId ? null : row.teamId)}
                        className={`cursor-pointer border-b border-white/5 hover:bg-white/5 ${mine ? "bg-green-500/10" : ""}`}
                      >
                        <td className="px-3 py-3 text-gray-400">
                          {row.rank}
                          {row.tied && "="}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-white">{row.name}</div>
                          {team?.franchise && team.ownName !== row.name && <div className="text-xs text-gray-500">{team.ownName}</div>}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-300">{pts(row.raw)}</td>
                        {data.config.franchiseAuctionEnabled && <td className="px-3 py-3 text-right text-green-300">{row.synergy ? `+${pts(row.synergy)}` : "—"}</td>}
                        <td className="px-3 py-3 text-right font-bold text-white">{pts(row.total)}</td>
                        <td className="hidden px-3 py-3 text-right text-gray-400 sm:table-cell">{formatLakhs(row.purse)}</td>
                      </tr>
                      {open === row.teamId && (
                        <tr>
                          <td colSpan={6} className="bg-black/20 px-3 py-3">
                            {row.players.length === 0 ? (
                              <p className="text-sm text-gray-400">No players yet — squads are built in the auction.</p>
                            ) : (
                              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                {row.players.map((p) => {
                                  const player = idx!.player.get(p.playerId);
                                  const real = player ? idx!.realTeam.get(player.teamId) : undefined;
                                  return (
                                    <div key={p.playerId} className="flex items-center justify-between gap-2 text-sm">
                                      <span className="flex items-center gap-2">
                                        <span className={`rounded px-1.5 text-[10px] font-semibold ${ROLE_STYLE[player?.role ?? ""] ?? ""}`}>{player?.role}</span>
                                        <span className="text-white">{player?.name ?? p.playerId}</span>
                                        <span className="text-xs text-gray-500">{real?.code}</span>
                                        {p.boosted && <span className="text-xs text-green-300">★</span>}
                                      </span>
                                      <span className="text-gray-300">
                                        {pts(p.total)} <span className="text-xs text-gray-500">({p.matches})</span>
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <p className="mt-3 text-xs text-gray-500">
            Ties are split by synergy points, then the team&apos;s best player, then purse left. Tap a team to see its players
            {data.config.franchiseAuctionEnabled && " (★ = franchise boost)"}.
          </p>
        </>
      )}
    </CricketShell>
  );
}
