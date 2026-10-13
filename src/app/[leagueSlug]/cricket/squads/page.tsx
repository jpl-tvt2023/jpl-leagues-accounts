"use client";

import { useLeague } from "@/lib/league-context";
import { CricketShell } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { SquadCard } from "../_components/SquadCard";

export default function CricketSquadsPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug);
  const rowById = new Map((data?.standings.rows ?? []).map((r) => [r.teamId, r]));
  const teams = [...(data?.teams ?? [])].sort((a, b) => (rowById.get(a.id)?.rank ?? 0) - (rowById.get(b.id)?.rank ?? 0));

  return (
    <CricketShell currentPage="teams" title="Squads" subtitle={data && `${data.teams.length} teams`} loading={!data} error={error} wide>
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          {teams.map((t) => (
            <SquadCard key={t.id} data={data} team={t} row={rowById.get(t.id)} highlight={t.id === data.myTeamId} />
          ))}
        </div>
      )}
    </CricketShell>
  );
}
