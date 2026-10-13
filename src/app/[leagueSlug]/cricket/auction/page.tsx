"use client";

import { useLeague } from "@/lib/league-context";
import { formatIst } from "@/lib/sports/cricket/sheets/ist";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";

const LABEL = { franchise: "Franchise auction", player: "Player auction" } as const;
const STATUS = { pending: "Not started", active: "Live", paused: "Paused", completed: "Finished" } as const;

/** The league's auction sessions. */
export default function CricketAuctionLobbyPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug, { pollMs: 15_000 });

  return (
    <CricketShell currentPage="auction" title="Auction" loading={!data} error={error}>
      {data && (
        <div className="space-y-3">
          {data.auctionSessions.length === 0 && (
            <Card>
              <p className="text-sm text-gray-300">The auction hasn&apos;t been set up yet. Your league admin schedules it.</p>
            </Card>
          )}
          {data.auctionSessions.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{LABEL[s.type]}</p>
                  <p className="text-xs text-gray-400">{s.scheduledAt ? `${formatIst(new Date(s.scheduledAt))} IST` : "Not scheduled"}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    s.status === "active" ? "bg-green-500/20 text-green-200" : s.status === "completed" ? "bg-white/10 text-gray-300" : "bg-amber-500/20 text-amber-200"
                  }`}
                >
                  {STATUS[s.status]}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </CricketShell>
  );
}
