"use client";

import { useLeague } from "@/lib/league-context";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { indexView, pts } from "../_components/view-helpers";

export default function CricketWinnersPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug);
  const s = data?.standings;
  const champions = s?.rows.filter((r) => r.rank === 1) ?? [];
  const podium = s?.rows.filter((r) => r.rank <= 3) ?? [];

  return (
    <CricketShell currentPage="winners" title="Winners" subtitle={data?.tournament.name} loading={!data} error={error}>
      {data &&
        s &&
        (!s.complete ? (
          <Card>
            <p className="text-sm text-gray-300">
              The season is still going — {s.fixturesScored} of {s.fixturesTotal} matches scored. The champion is crowned once every
              match has its points.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="border-yellow-400/40 bg-gradient-to-br from-yellow-400/20 to-amber-600/10 text-center">
              <div className="text-5xl">🏆</div>
              <p className="mt-2 text-xs uppercase tracking-widest text-yellow-200">Champion{champions.length > 1 ? "s" : ""}</p>
              <p className="mt-1 text-2xl font-bold text-white">{champions.map((c) => c.name).join(" & ")}</p>
              <p className="text-sm text-yellow-100">{pts(champions[0]?.total ?? 0)} points</p>
            </Card>
            <Card>
              <h2 className="mb-2 font-semibold text-white">Final top three</h2>
              <ul className="divide-y divide-white/5 text-sm">
                {podium.map((r) => {
                  const top = r.topScorerId ? indexView(data).player.get(r.topScorerId) : undefined;
                  return (
                    <li key={r.teamId} className="flex justify-between py-2">
                      <span className="text-white">
                        {r.rank}. {r.name}
                        {top && <span className="ml-2 text-xs text-gray-500">best: {top.name}</span>}
                      </span>
                      <span className="font-semibold text-white">{pts(r.total)}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        ))}
    </CricketShell>
  );
}
