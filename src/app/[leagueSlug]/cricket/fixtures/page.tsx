"use client";

import { useMemo, useState } from "react";
import { useLeague } from "@/lib/league-context";
import { formatIst } from "@/lib/sports/cricket/sheets/ist";
import { CricketShell, Card } from "../_components/CricketShell";
import { useCricketLeague } from "../_components/useCricketLeague";
import { indexView, pts } from "../_components/view-helpers";

interface FixturePoint {
  playerId: number;
  name: string;
  teamId: number;
  role: string;
  points: number;
  ownerTeamId: string | null;
  boosted: boolean;
  total: number;
}

const STATUS_LABEL: Record<string, string> = { scheduled: "Upcoming", completed: "Scored", abandoned: "Abandoned" };

export default function CricketFixturesPage() {
  const { league } = useLeague();
  const { data, error } = useCricketLeague(league.slug);
  const idx = useMemo(() => (data ? indexView(data) : null), [data]);
  const [open, setOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<number, FixturePoint[]>>({});

  const toggle = async (fixtureId: number) => {
    if (open === fixtureId) {
      setOpen(null);
      return;
    }
    setOpen(fixtureId);
    if (!detail[fixtureId]) {
      const res = await fetch(`/api/cricket/fixture?league=${encodeURIComponent(league.slug)}&fixtureId=${fixtureId}`);
      const body = await res.json();
      setDetail((d) => ({ ...d, [fixtureId]: res.ok ? body.rows : [] }));
    }
  };

  // Each manager's points in each fixture, from the standings breakdown.
  const managerScores = useMemo(() => {
    const m = new Map<number, Array<{ teamId: string; name: string; total: number }>>();
    for (const row of data?.standings.rows ?? []) {
      for (const f of row.fixtures) {
        const list = m.get(f.fixtureId) ?? [];
        list.push({ teamId: row.teamId, name: row.name, total: f.total });
        m.set(f.fixtureId, list);
      }
    }
    for (const list of m.values()) list.sort((a, b) => b.total - a.total);
    return m;
  }, [data]);

  // Group by IST date.
  const days = useMemo(() => {
    const groups: Array<{ day: string; fixtures: NonNullable<typeof data>["fixtures"] }> = [];
    for (const f of data?.fixtures ?? []) {
      const day = formatIst(new Date(f.startsAt)).slice(0, 10);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.fixtures.push(f);
      else groups.push({ day, fixtures: [f] });
    }
    return groups;
  }, [data]);

  return (
    <CricketShell currentPage="fixtures" title="Fixtures" subtitle={data && `${data.tournament.name} · times in IST`} loading={!data} error={error}>
      {data && idx && (
        <div className="space-y-5">
          {days.length === 0 && <p className="text-sm text-gray-400">No fixtures uploaded yet.</p>}
          {days.map((g) => (
            <div key={g.day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {new Date(`${g.day}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
              </h2>
              <div className="space-y-2">
                {g.fixtures.map((f) => {
                  const a = idx.realTeam.get(f.teamAId);
                  const b = idx.realTeam.get(f.teamBId);
                  const scores = managerScores.get(f.id) ?? [];
                  return (
                    <Card key={f.id} className="p-0 sm:p-0">
                      <button type="button" onClick={() => f.scored && toggle(f.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${f.scored ? "hover:bg-white/5" : "cursor-default"}`}>
                        <span>
                          <span className="font-semibold text-white">
                            {a?.code ?? "?"} v {b?.code ?? "?"}
                          </span>
                          <span className="ml-2 text-xs text-gray-500">
                            {f.series} #{f.fixtureNo} · {f.matchFormat} · {formatIst(new Date(f.startsAt)).slice(11)}
                            {f.venue && ` · ${f.venue}`}
                          </span>
                        </span>
                        <span className={`text-xs ${f.status === "completed" ? "text-green-300" : f.status === "abandoned" ? "text-amber-300" : "text-gray-400"}`}>
                          {STATUS_LABEL[f.status]}
                        </span>
                      </button>
                      {open === f.id && (
                        <div className="border-t border-white/10 px-4 py-3">
                          {scores.length > 0 && (
                            <div className="mb-3 flex flex-wrap gap-2">
                              {scores.map((s) => (
                                <span key={s.teamId} className={`rounded-full px-2 py-0.5 text-xs ${s.teamId === data.myTeamId ? "bg-green-500/20 text-green-200" : "bg-white/10 text-gray-200"}`}>
                                  {s.name}: <span className="font-semibold">{pts(s.total)}</span>
                                </span>
                              ))}
                            </div>
                          )}
                          {!detail[f.id] ? (
                            <p className="text-sm text-gray-400">Loading…</p>
                          ) : (
                            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                              {detail[f.id].map((p) => (
                                <div key={p.playerId} className="flex justify-between gap-2">
                                  <span>
                                    <span className="text-white">{p.name}</span>{" "}
                                    <span className="text-xs text-gray-500">
                                      {idx.realTeam.get(p.teamId)?.code} · {p.ownerTeamId ? idx.team.get(p.ownerTeamId)?.name : "unsold"}
                                    </span>
                                  </span>
                                  <span className="text-gray-200">
                                    {pts(p.points)}
                                    {p.boosted && <span className="ml-1 text-xs text-green-300">→ {pts(p.total)}</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </CricketShell>
  );
}
