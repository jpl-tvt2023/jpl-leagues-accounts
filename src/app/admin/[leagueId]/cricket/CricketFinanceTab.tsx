"use client";

import { useEffect, useState } from "react";
import { formatLakhs } from "@/lib/format/currency";
import type { FinanceRow } from "@/lib/sports/cricket/admin";

/** Finance: where each team's money went — players, its franchise and penalty redemptions. */
export function CricketFinanceTab({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<{ startingPurse: number; rows: FinanceRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/${leagueId}/cricket/finance`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (res.ok) setData(body);
      else setError(body.error ?? "Couldn't load the finances");
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading finances…</p>;
  const total = (f: FinanceRow) => f.players.spent + (f.franchise?.price ?? 0) + f.penalties.redemptionSpent;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white">Finance</h2>
        <p className="mt-1 text-sm text-gray-400">Every team started with {formatLakhs(data.startingPurse)}. Spending is players, the franchise, and penalty slots redeemed.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-gray-400">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3 text-right">Players</th>
              <th className="px-4 py-3">Franchise</th>
              <th className="px-4 py-3 text-right">Penalties</th>
              <th className="px-4 py-3 text-right">Spent</th>
              <th className="px-4 py-3 text-right">Purse left</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((f) => {
              const adds = total(f) === f.spent && f.spent + f.purse === data.startingPurse;
              return (
                <tr key={f.teamId} className="border-b border-white/5">
                  <td className="px-4 py-3 font-semibold text-white">{f.name}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {f.players.count} · {formatLakhs(f.players.spent)}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{f.franchise ? `${f.franchise.name} · ${formatLakhs(f.franchise.price)}` : "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {f.penalties.incurred === 0 ? (
                      "—"
                    ) : (
                      <>
                        {f.penalties.incurred} incurred · {f.penalties.redeemed} redeemed ({formatLakhs(f.penalties.redemptionSpent)})
                        {f.penalties.open > 0 && <span className="block text-xs text-amber-300">{f.penalties.open} open</span>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {formatLakhs(f.spent)}
                    {!adds && (
                      <span className="block text-xs text-amber-300" title="Players + franchise + redemptions doesn't match the team's spending — check the auction's corrections">
                        doesn&apos;t add up
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-white">{formatLakhs(f.purse)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
