"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLeague } from "@/lib/league-context";
import { formatLakhs } from "@/lib/format/currency";
import { formatIst } from "@/lib/sports/cricket/sheets/ist";
import { ROLES } from "@/lib/sports/cricket/squad-rules";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { indexView, pts } from "../_components/view-helpers";

const SESSION_LABEL = { franchise: "Franchise auction", player: "Player auction" } as const;

export default function CricketDashboardPage() {
  const { league, viewer } = useLeague();
  const router = useRouter();
  const { data, error } = useCricketLeague(league.slug, { pollMs: 60_000 });

  // No team here: the league's public standings are the useful page.
  useEffect(() => {
    if (data && !data.myTeamId) router.replace(`/${league.slug}/cricket/standings`);
  }, [data, league.slug, router]);

  const team = data?.teams.find((t) => t.id === data.myTeamId);
  const row = data?.standings.rows.find((r) => r.teamId === data.myTeamId);
  const idx = data ? indexView(data) : null;
  const live = data?.auctionSessions.find((s) => s.status === "active" || s.status === "paused");
  const next = data?.auctionSessions.find((s) => s.status === "pending");
  const fixtureById = new Map((data?.fixtures ?? []).map((f) => [f.id, f]));
  const startOf = (id: number) => fixtureById.get(id)?.startsAt ?? "";
  const recent = row ? [...row.fixtures].sort((a, b) => startOf(b.fixtureId).localeCompare(startOf(a.fixtureId))).slice(0, 5) : [];

  return (
    <CricketShell
      currentPage="dashboard"
      title={team ? team.name : "Dashboard"}
      subtitle={data && `${data.tournament.name} · ${viewer.username ? `@${viewer.username}` : league.name}`}
      loading={!data || !team}
      error={error}
    >
      {data && team && idx && (
        <div className="space-y-4">
          {live && (
            <Link href={`/${league.slug}/cricket/auction`} className="block rounded-2xl border border-green-400/50 bg-green-500/15 p-4 text-green-100 hover:bg-green-500/25">
              🔴 {SESSION_LABEL[live.type]} is {live.status === "paused" ? "paused" : "live"} — go to the auction room →
            </Link>
          )}
          {!live && next && (
            <Card>
              <p className="text-sm text-gray-300">
                Next: <span className="font-semibold text-white">{SESSION_LABEL[next.type]}</span>
                {next.scheduledAt ? ` · ${formatIst(new Date(next.scheduledAt))} IST` : " · not scheduled yet"}
              </p>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-gray-400">Rank</p>
              <p className="text-2xl font-bold text-white">
                {row ? `${row.rank}${row.tied ? "=" : ""}` : "—"} <span className="text-sm font-normal text-gray-400">of {data.teams.length}</span>
              </p>
              <p className="text-sm text-gray-300">{pts(row?.total ?? 0)} points</p>
            </Card>
            <Card>
              <p className="text-xs text-gray-400">Purse left</p>
              <p className="text-2xl font-bold text-white">{formatLakhs(team.purse)}</p>
              <p className="text-sm text-gray-300">spent {formatLakhs(team.spent)}</p>
            </Card>
            <Card>
              <p className="text-xs text-gray-400">Franchise</p>
              <p className="text-2xl font-bold text-white">{team.franchise ? team.franchise.code : "—"}</p>
              <p className="text-sm text-gray-300">
                {team.franchise
                  ? `${team.franchise.name} · +${data.config.franchiseBoostPercent}%`
                  : data.config.franchiseAuctionEnabled
                    ? "Bought in the franchise auction"
                    : "No franchise auction"}
              </p>
            </Card>
          </div>

          <Card>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">Squad</h2>
              <Link href={`/${league.slug}/cricket/squad`} className="text-sm text-green-300 hover:underline">
                View squad →
              </Link>
            </div>
            <p className="mt-2 text-sm text-gray-300">
              {team.squadSize} of {data.config.squadRules.minSize}–{data.config.squadRules.maxSize - team.penaltySlots} players ·{" "}
              {ROLES.map((r) => `${r} ${team.roleCounts[r]}`).join(" · ")}
            </p>
          </Card>

          <Card>
            <h2 className="font-semibold text-white">Recent matches</h2>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">No points yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-white/5 text-sm">
                {recent.map((f) => {
                  const fx = fixtureById.get(f.fixtureId);
                  return (
                    <li key={f.fixtureId} className="flex justify-between py-1.5">
                      <span className="text-gray-300">
                        {fx ? `${idx.realTeam.get(fx.teamAId)?.code} v ${idx.realTeam.get(fx.teamBId)?.code}` : `Fixture ${f.fixtureId}`}
                        {fx && <span className="ml-2 text-xs text-gray-500">{fx.series} #{fx.fixtureNo}</span>}
                      </span>
                      <span className="font-semibold text-white">{pts(f.total)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </CricketShell>
  );
}
