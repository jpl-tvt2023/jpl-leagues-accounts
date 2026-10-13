"use client";

import { Fragment, useEffect, useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { SortableTh, nextSort, sortRows, type SortState } from "@/components/ui/SortableTh";
import { formatLakhs } from "@/lib/format/currency";
import { PLAYOFFS_FOOTNOTE, t20MatchesLabel, type PlayoffState } from "@/lib/sports/cricket/match-counts";

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

/** Sortable columns per table: header label and the value it sorts by. */
const COLUMNS: Record<View, Array<{ key: string; label: string; value: (r: Row) => unknown }>> = {
  teams: [
    { key: "code", label: "Code", value: (r) => r.code },
    { key: "name", label: "Name", value: (r) => r.name },
    { key: "basePrice", label: "Franchise base price", value: (r) => r.basePrice },
  ],
  players: [
    { key: "code", label: "player_id", value: (r) => r.code },
    { key: "name", label: "Name", value: (r) => r.name },
    { key: "team", label: "Team", value: (r) => r.team },
    { key: "role", label: "Role", value: (r) => r.role },
    { key: "basePrice", label: "Base price", value: (r) => r.basePrice },
    { key: "overseas", label: "Overseas", value: (r) => r.overseas },
    { key: "matches", label: "Test / ODI / T20", value: (r) => Number(r.matchesT20) + Number(r.playoffMatches ?? 0) + Number(r.matchesOdi) + Number(r.matchesTest) },
  ],
  fixtures: [
    { key: "series", label: "Series", value: (r) => r.series },
    { key: "fixtureNo", label: "#", value: (r) => r.fixtureNo },
    { key: "stage", label: "Stage", value: (r) => r.stage },
    { key: "format", label: "Format", value: (r) => r.format },
    { key: "match", label: "Match", value: (r) => `${r.teamA} v ${r.teamB}` },
    { key: "startsIst", label: "Start (IST)", value: (r) => r.startsIst },
    { key: "status", label: "Status", value: (r) => r.status },
    { key: "pointsRows", label: "Points rows", value: (r) => r.pointsRows },
  ],
  uploads: [
    { key: "createdAt", label: "When", value: (r) => r.createdAt },
    { key: "kind", label: "Sheet", value: (r) => uploadSheet(r) },
    { key: "fileName", label: "File", value: (r) => r.fileName },
    { key: "rowCount", label: "Rows", value: (r) => r.rowCount },
    { key: "result", label: "Result", value: (r) => Number((r.summary as Record<string, number> | undefined)?.inserts ?? 0) },
    { key: "by", label: "By", value: (r) => r.by },
  ],
};

const DEFAULT_SORT: Record<View, SortState> = {
  teams: { key: "code", dir: "asc" },
  players: { key: "name", dir: "asc" },
  fixtures: { key: "startsIst", dir: "asc" },
  uploads: { key: "createdAt", dir: "desc" },
};

function uploadSheet(r: Row): string {
  const stage = (r.summary as Record<string, unknown> | undefined)?.stage;
  return r.kind === "fixtures" && stage === "playoff" ? "fixtures (playoffs)" : String(r.kind);
}

/** What the tournament currently holds, in sortable tables. `version` changes after every upload, to reload. */
export function DataTables({ tournamentId, version, onChanged }: { tournamentId: string; version: number; onChanged: () => void }) {
  const [view, setView] = useState<View>("teams");
  // Rows with the view they were loaded for, so switching tabs never renders one table's rows with
  // another's columns while the new ones load.
  const [loaded, setLoaded] = useState<{ view: View; version: number; rows: Row[]; playoffs: PlayoffState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFixture, setOpenFixture] = useState<number | null>(null);
  const [fixturePoints, setFixturePoints] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState("");
  // Each table remembers its own sort.
  const [sorts, setSorts] = useState<Record<View, SortState>>(DEFAULT_SORT);
  const sort = sorts[view];
  const onSort = (key: string) => setSorts((s) => ({ ...s, [view]: nextSort(s[view], key) }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=${view}`);
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) setError(data.error ?? "Couldn't load");
      else {
        setError(null);
        setLoaded({ view, version, rows: data.rows, playoffs: data.playoffs ?? "none" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tournamentId, view, version]);

  const rows = loaded && loaded.view === view && loaded.version === version ? loaded.rows : null;
  const playoffs = loaded?.playoffs ?? "none";

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
  const filtered = (rows ?? []).filter((r) => !q || Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
  const column = COLUMNS[view].find((c) => c.key === sort.key) ?? COLUMNS[view][0];
  const shown = sortRows(filtered, column.value, sort.dir);
  const headers = (
    <tr>
      {COLUMNS[view].map((c) => (
        <SortableTh key={c.key} sortKey={c.key} label={c.label} sort={sort} onSort={onSort} />
      ))}
      {view === "fixtures" && <th className="px-3 py-2" />}
    </tr>
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <Tabs<View> ariaLabel="Tournament data" className="mb-4" value={view} onChange={setView} items={TABS} />
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter…"
        className="mb-3 w-full max-w-xs rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
      />
      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing here yet.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-lg border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-800 text-gray-400">{headers}</thead>
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
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {String(r.matchesTest)} / {String(r.matchesOdi)} / {t20MatchesLabel(Number(r.matchesT20), playoffs, Number(r.playoffMatches ?? 0))}
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
                        <td className="px-3 py-1.5">{r.stage === "playoff" ? <span className="text-yellow-300">Playoff</span> : "Group"}</td>
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
                          <td colSpan={9} className="bg-black/30 px-3 py-2">
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
                      <td className="px-3 py-1.5 whitespace-nowrap">{uploadSheet(r)}</td>
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
          {view === "players" && playoffs === "pending" && <p className="px-3 py-2 text-xs text-gray-500">{PLAYOFFS_FOOTNOTE}</p>}
        </div>
      )}
    </section>
  );
}
