"use client";

import Link from "next/link";
import { useLeague } from "@/lib/league-context";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { SquadCard } from "../_components/SquadCard";

export default function CricketMySquadPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug);
  const team = data?.teams.find((t) => t.id === data.myTeamId);
  const row = data?.standings.rows.find((r) => r.teamId === data.myTeamId);

  return (
    <CricketShell currentPage="squad" title="My squad" loading={!data} error={error}>
      {data &&
        (team ? (
          <SquadCard data={data} team={team} row={row} />
        ) : (
          <Card>
            <p className="text-sm text-gray-300">
              You&apos;re not on a team in this league. See every team on{" "}
              <Link href={`/${league.slug}/cricket/squads`} className="text-green-300 hover:underline">
                Squads
              </Link>
              .
            </p>
          </Card>
        ))}
    </CricketShell>
  );
}
