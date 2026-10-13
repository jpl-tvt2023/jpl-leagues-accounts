"use client";

import { Fragment, useEffect, useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { formatLakhs } from "@/lib/format/currency";

type View = "teams" | "players" | "fixtures" | "uploads";

type Row = Record<string, unknown>;

const TABS: { id: View; label: string }[] = [
  { id: "teams", label: "Teams" },
  { id: "players", label: "Players" },
  { id: "fixtures", label: "Fixtures" },
  { id: "uploads", label: "Upload history" },
];

const STATUS_STYLE: Record<string, string> = {
  scheduled: "text-gray-400",
  completed: "text-green-300",
  abandoned: "text-amber-300",
};

/** What the tournament currently holds. `version` changes after every upload, to reload. */
export function DataTables({ tournamentId, version, onChanged }: { tournamentId: string; version: number; onChanged: () => void }) {
  const [view, setView] = useState<View>("teams");
  // Rows with the view they were loaded for, so switching tabs never renders one table's rows with
  // another's columns while the new ones load.
  const [loaded, setLoaded] = useState<{ view: View; version: number; rows: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFixture, setOpenFixture] = useState<number | null>(null);
  const [fixturePoints, setFixturePoints] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=${view}`);
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) setError(data.error ?? "Couldn't load");
      else {
        setError(null);
        setLoaded({ view, version, rows: data.rows });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, view, version]);

  const rows = loaded && loaded.view === view && loaded.version === version ? loaded.rows : null;

  const showPoints = async (fixtureId: number) => {
    if (openFixture === fixtureId) {
      setOpenFixture(null);
      return;
    }
    setOpenFixture(fixtureId);
    setFixturePoints(null);
    const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=points&fixtureId=${fixtureId}`);
    const data = await res.json();
    setFixturePoints(res.ok ? data.rows : []);
  };

  const fixtureAction = async (fixtureId: number, action: "abandon" | "reinstate" | "clear-points") => {
    if (action === "clear-points" && !confirm("Delete every point uploaded for this fixture?")) return;
    const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}/fixtures/${fixtureId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "That didn't work");
      return;
    }
    onChanged();
  };

  const q = filter.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !q || Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <Tabs<View> ariaLabel="Tournament data" className="mb-4" value={view} onChange={setView} items={TABS} />
      {view !== "uploads" && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="mb-3 w-full max-w-xs rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
        />
      )}
      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing here yet.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-800 text-gray-400">
              {view === "teams" && (
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Franchise base price</th>
                </tr>
              )}
              {view === "players" && (
                <tr>
                  <th className="px-3 py-2">player_id</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Base price</th>
                  <th className="px-3 py-2">Overseas</th>
                  <th className="px-3 py-2">Test / ODI / T20</th>
                </tr>
              )}
              {view === "fixtures" && (
                <tr>
                  <th className="px-3 py-2">Series</th>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2">Match</th>
                  <th className="px-3 py-2">Start (IST)</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Points rows</th>
                  <th className="px-3 py-2" />
                </tr>
              )}
              {view === "uploads" && (
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Sheet</th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Rows</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">By</th>
                </tr>
              )}
            </thead>
            <tbody className="text-gray-200">
              {view === "teams" &&
                shown.map((r) => (
                  <tr key={String(r.id)} className="border-t border-white/5">
                    <td className="px-3 py-1.5 font-semibold">{String(r.code)}</td>
                    <td className="px-3 py-1.5">{String(r.name)}</td>
                    <td className="px-3 py-1.5">{formatLakhs(Number(r.basePrice))}</td>
                  </tr>
                ))}
              {view === "players" &&
                shown.map((r) => (
                  <tr key={String(r.id)} className="border-t border-white/5">
                    <td className="px-3 py-1.5 text-gray-400">{String(r.code)}</td>
                    <td className="px-3 py-1.5">{String(r.name)}</td>
                    <td className="px-3 py-1.5">{String(r.team)}</td>
                    <td className="px-3 py-1.5">{String(r.role)}</td>
                    <td className="px-3 py-1.5">{formatLakhs(Number(r.basePrice))}</td>
                    <td className="px-3 py-1.5">{r.overseas ? "Y" : ""}</td>
                    <td className="px-3 py-1.5">
                      {String(r.matchesTest)} / {String(r.matchesOdi)} / {String(r.matchesT20)}
                    </td>
                  </tr>
                ))}
              {view === "fixtures" &&
                shown.map((r) => {
                  const id = Number(r.id);
                  return (
                    <Fragment key={id}>
                      <tr className="border-t border-white/5">
                        <td className="px-3 py-1.5">{String(r.series)}</td>
                        <td className="px-3 py-1.5">{String(r.fixtureNo)}</td>
                        <td className="px-3 py-1.5">{String(r.format)}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {String(r.teamA)} v {String(r.teamB)}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{String(r.startsIst)}</td>
                        <td className={`px-3 py-1.5 ${STATUS_STYLE[String(r.status)] ?? ""}`}>{String(r.status)}</td>
                        <td className="px-3 py-1.5">
                          {Number(r.pointsRows) > 0 ? (
                            <button type="button" onClick={() => showPoints(id)} className="text-green-300 underline">
                              {String(r.pointsRows)}
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-right">
                          {r.status === "abandoned" ? (
                            <button type="button" onClick={() => fixtureAction(id, "reinstate")} className="text-gray-300 hover:text-white">
                              Reinstate
                            </button>
                          ) : (
                            <button type="button" onClick={() => fixtureAction(id, "abandon")} className="text-amber-300 hover:text-amber-200">
                              Abandon
                            </button>
                          )}
                          {Number(r.pointsRows) > 0 && (
                            <button type="button" onClick={() => fixtureAction(id, "clear-points")} className="ml-3 text-red-300 hover:text-red-200">
                              Clear points
                            </button>
                          )}
                        </td>
                      </tr>
                      {openFixture === id && (
                        <tr>
                          <td colSpan={8} className="bg-black/30 px-3 py-2">
                            {fixturePoints === null ? (
                              <span className="text-gray-400">Loading…</span>
                            ) : (
                              <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                                {fixturePoints.map((p) => (
                                  <div key={String(p.code)} className="flex justify-between gap-3">
                                    <span>
                                      {String(p.name)} <span className="text-gray-500">{String(p.team)}</span>
                                    </span>
                                    <span className="font-semibold">{String(p.points)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              {view === "uploads" &&
                shown.map((r) => {
                  const s = (r.summary ?? {}) as Record<string, number>;
                  return (
                    <tr key={String(r.id)} className="border-t border-white/5">
                      <td className="px-3 py-1.5 whitespace-nowrap">{new Date(String(r.createdAt)).toLocaleString("en-IN")}</td>
                      <td className="px-3 py-1.5">{String(r.kind)}</td>
                      <td className="px-3 py-1.5">{String(r.fileName ?? "")}</td>
                      <td className="px-3 py-1.5">{String(r.rowCount)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        +{s.inserts ?? 0} ~{s.updates ?? 0} −{s.deletes ?? 0}
                        {s.override ? <span className="ml-1 text-amber-300">override ×{s.override}</span> : null}
                      </td>
                      <td className="px-3 py-1.5">{String(r.by ?? "")}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
