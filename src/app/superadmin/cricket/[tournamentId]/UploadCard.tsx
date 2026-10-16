"use client";

import { useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { POINTS_MATCH_COLUMNS, SHEET_COLUMNS } from "@/lib/sports/cricket/sheets/columns";
import { SHEET_TITLES } from "@/lib/sports/cricket/sheets/templates";
import { downloadTemplate, readSheetFile } from "@/lib/sports/cricket/sheets/client";
import type { RawRow, SheetChange, SheetIssue, SheetKind } from "@/lib/sports/cricket/sheets/types";

interface UploadResult {
  kind: SheetKind;
  committed: boolean;
  counts: { rows: number; inserts: number; updates: number; deletes: number; unchanged: number; fixtures?: number };
  issues: SheetIssue[];
  errorCount: number;
  warningCount: number;
  overridableCount: number;
  canCommit: boolean;
  changes: SheetChange[];
  changeCount: number;
  preview: Array<Record<string, string | number | boolean | null>>;
  validationHash: string;
}

const PLAYOFF_INTRO =
  "The playoff fixtures, once the teams are known. Their ids continue from the group stage (leave fixture_id blank to number them in order). Replaces the playoffs only; the group stage is untouched.";
const GROUP_INTRO = "The group-stage fixtures. Fixture ids restart at 1 in each series. Replaces the group stage only; the playoffs are uploaded separately.";

const INTRO: Record<SheetKind, string> = {
  teams: "The full list of teams (IPL franchises, or countries). Replaces the current list.",
  players: "The full player list. Replaces the current list. Name and team are enough; a player keeps their place in squads as long as their name (or player_id) stays the same.",
  fixtures: "The full fixture list. Fixture ids restart at 1 in each series. Replaces the current list.",
  points:
    "Fantasy points as a grid: team code and player name, then one column per match (headed by its fixture id), rows in any order. Upload the same sheet after every game: new scores are added, changes to saved scores are listed for you to confirm, and nothing is deleted.",
};

function countsLine(kind: SheetKind, c: UploadResult["counts"]): string {
  if (kind === "points") {
    return `${c.inserts} new · ${c.updates} changed · ${c.unchanged} unchanged, in ${c.fixtures ?? 0} fixture(s)`;
  }
  return `${c.inserts} new · ${c.updates} changed · ${c.deletes} removed · ${c.unchanged} unchanged`;
}

const byLevelThenRow = (a: SheetIssue, b: SheetIssue) => (a.level === b.level ? a.row - b.row : a.level === "error" ? -1 : 1);

/** Row · Column · Problem, errors first. */
function IssuesTable({ issues, className }: { issues: SheetIssue[]; className: string }) {
  return (
    <div className={`overflow-auto rounded-lg border border-white/10 ${className}`}>
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-800 text-gray-400">
          <tr>
            <th className="px-3 py-2">Row</th>
            <th className="px-3 py-2">Column</th>
            <th className="px-3 py-2">Problem</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i, n) => (
            <tr key={n} className="border-t border-white/5">
              <td className="px-3 py-1.5 text-gray-400">{i.row || "—"}</td>
              <td className="px-3 py-1.5 text-gray-400">{i.column ?? ""}</td>
              <td className={`px-3 py-1.5 ${i.level === "error" ? "text-red-300" : "text-amber-300"}`}>
                {i.message}
                {i.overridable && <span className="ml-1 text-gray-400">(can be overridden)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One sheet: template download, file pick, server validation preview, then commit. For a league
 * tournament the Fixtures card has two modes: the group stage, and the playoffs (ids follow on). With
 * several series, the Points card asks which series the sheet's match columns are.
 *
 * A file that fails validation pops up its problems. Saving new data needs nothing more; an upload
 * that changes or removes saved rows first lists them (old → new) for the superadmin to confirm.
 */
export function UploadCard({
  tournamentId,
  kind,
  tournamentKind,
  nextPlayoffIds,
  series,
  onCommitted,
}: {
  tournamentId: string;
  kind: SheetKind;
  tournamentKind: "league" | "window";
  nextPlayoffIds: Record<string, number>;
  series: string[];
  onCommitted: () => void;
}) {
  const hasStages = kind === "fixtures" && tournamentKind === "league";
  const [stage, setStage] = useState<"group" | "playoff">("group");
  const hasSeries = kind === "points" && series.length > 1;
  const [pickedSeries, setPickedSeries] = useState(series[0] ?? "");
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState<"reading" | "validating" | "committing" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  // The pop-ups: why the file can't be saved, or the saved rows it changes.
  const [dialog, setDialog] = useState<"problems" | "changes" | null>(null);
  const [problemNote, setProblemNote] = useState<string | null>(null);
  const showProblems = (note: string | null) => {
    setProblemNote(note);
    setDialog("problems");
  };

  const call = async (mode: "validate" | "commit", sheetRows: RawRow[], hash?: string, confirmChanges = false) => {
    const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        mode,
        rows: sheetRows,
        fileName,
        validationHash: hash,
        override,
        ...(hasStages ? { stage } : {}),
        ...(hasSeries ? { series: pickedSeries } : {}),
        ...(confirmChanges ? { confirmChanges: true } : {}),
      }),
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    setResult(null);
    setOverride(false);
    setFileName(file.name);
    setBusy("reading");
    try {
      const parsed = await readSheetFile(file);
      setRows(parsed);
      setBusy("validating");
      const { ok, data } = await call("validate", parsed);
      if (!ok) {
        setMessage({ tone: "error", text: data.error ?? "Validation failed" });
        showProblems(data.error ?? "Validation failed");
      } else {
        setResult(data);
        if (data.errorCount > 0) showProblems(null);
      }
    } catch (err) {
      const text = `Couldn't read that file: ${err instanceof Error ? err.message : String(err)}`;
      setMessage({ tone: "error", text });
      showProblems(text);
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  // The Points template is this tournament's grid: every player (by team), and the series' fixture ids.
  const template = async () => {
    const forSeries = hasSeries ? pickedSeries : series[0];
    if (kind !== "points" || !forSeries) {
      downloadTemplate(kind, hasStages && stage === "playoff" ? { nextIds: nextPlayoffIds } : undefined);
      return;
    }
    setMessage(null);
    try {
      const base = `/api/superadmin/cricket/tournaments/${tournamentId}/data?kind=`;
      const [players, fixtures] = await Promise.all([
        fetch(`${base}players`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`players: ${r.status}`)))),
        fetch(`${base}fixtures`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fixtures: ${r.status}`)))),
      ]);
      const fixtureIds = [...new Set((fixtures.rows as Array<{ series: string; fixtureNo: number }>).filter((f) => f.series === forSeries).map((f) => f.fixtureNo))].sort((a, b) => a - b);
      const rows = (players.rows as Array<{ team: string; name: string }>)
        .map((p) => ({ team: p.team, name: p.name }))
        .sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
      downloadTemplate(kind, undefined, { fixtureIds, players: rows });
    } catch (err) {
      setMessage({ tone: "error", text: `Couldn't build the template: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  // Save: straight away when the upload only adds data; changes to saved rows are confirmed first.
  const save = () => {
    if (result && result.changeCount > 0) setDialog("changes");
    else void commit(false);
  };

  const commit = async (confirmChanges: boolean) => {
    if (!rows || !result) return;
    setBusy("committing");
    setMessage(null);
    try {
      const { ok, status, data } = await call("commit", rows, result.validationHash, confirmChanges);
      if (ok) {
        setDialog(null);
        setMessage({ tone: "success", text: `Saved: ${countsLine(kind, data.counts)}.` });
        setResult(null);
        setRows(null);
        onCommitted();
        return;
      }
      if (data.result) setResult(data.result);
      if (status === 428) {
        setDialog("changes");
        return;
      }
      const text = status === 409 ? `${data.error} Pick the file again.` : data.error ?? "Commit failed";
      setMessage({ tone: "error", text });
      showProblems(text);
    } finally {
      setBusy(null);
    }
  };

  const canCommit = !!result && (result.canCommit || (override && result.errorCount === result.overridableCount));
  const previewColumns = result?.preview[0] ? Object.keys(result.preview[0]) : [];
  const issues = result ? [...result.issues].sort(byLevelThenRow) : [];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{SHEET_TITLES[kind]}</h3>
          <p className="mt-1 max-w-xl text-sm text-gray-400">{hasStages ? (stage === "playoff" ? PLAYOFF_INTRO : GROUP_INTRO) : INTRO[kind]}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={template}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm text-gray-200 hover:bg-white/10"
          >
            Template
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
            className="rounded-lg bg-green-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-50"
          >
            {busy === "reading" ? "Reading…" : busy === "validating" ? "Checking…" : "Upload file"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>
      </div>

      {hasStages && (
        <div role="group" aria-label="Fixtures stage" className="mt-3 inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5 text-sm">
          {(["group", "playoff"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={stage === s}
              disabled={busy !== null}
              onClick={() => {
                if (s === stage) return;
                // A preview was checked against the other stage; start again.
                setStage(s);
                setResult(null);
                setRows(null);
                setMessage(null);
              }}
              className={`rounded-md px-3 py-1 ${stage === s ? "bg-green-500 font-semibold text-slate-900" : "text-gray-300 hover:text-white"}`}
            >
              {s === "group" ? "Group stage" : "Playoffs"}
            </button>
          ))}
        </div>
      )}

      {hasSeries && (
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-300">
          Series
          <select
            value={pickedSeries}
            disabled={busy !== null}
            onChange={(e) => {
              // A preview was checked against the other series; start again.
              setPickedSeries(e.target.value);
              setResult(null);
              setRows(null);
              setMessage(null);
            }}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
          >
            {series.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}

      <details className="mt-3 text-xs text-gray-400">
        <summary className="cursor-pointer select-none text-gray-300">Columns</summary>
        <ul className="mt-2 space-y-1">
          {SHEET_COLUMNS[kind].map((c) => (
            <li key={c.field}>
              <code className="rounded bg-white/10 px-1 text-gray-200">{c.header}</code>
              {c.required ? "" : " (optional)"} — {c.help}
            </li>
          ))}
          {kind === "points" && (
            <li>
              <code className="rounded bg-white/10 px-1 text-gray-200">{POINTS_MATCH_COLUMNS.header}</code> — {POINTS_MATCH_COLUMNS.help}
            </li>
          )}
        </ul>
      </details>

      {message && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            message.tone === "error" ? "border border-red-500/40 bg-red-500/10 text-red-300" : "border border-green-500/40 bg-green-500/10 text-green-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm text-gray-200">
            <span className="font-semibold">{fileName}</span>: {result.counts.rows} rows · {countsLine(kind, result.counts)}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2 py-0.5 ${result.errorCount ? "bg-red-500/20 text-red-300" : "bg-green-500/20 text-green-300"}`}>
              {result.errorCount} error{result.errorCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
              {result.warningCount} warning{result.warningCount === 1 ? "" : "s"}
            </span>
          </div>

          {issues.length > 0 && <IssuesTable issues={issues} className="max-h-64" />}

          {result.preview.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-800 text-gray-400">
                  <tr>
                    {previewColumns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-2">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((r, n) => (
                    <tr key={n} className="border-t border-white/5 text-gray-200">
                      {previewColumns.map((c) => (
                        <td key={c} className="whitespace-nowrap px-3 py-1.5">
                          {r[c] === null ? "" : String(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.counts.rows > result.preview.length && (
                <p className="px-3 py-2 text-xs text-gray-500">Showing the first {result.preview.length} rows.</p>
              )}
            </div>
          )}

          {result.overridableCount > 0 && (
            <label className="flex items-start gap-2 text-sm text-amber-200">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-1" />
              Override: save the {result.overridableCount} change(s) that alter results after an auction started. This is recorded.
            </label>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canCommit || busy !== null}
              onClick={save}
              className="rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-green-400 disabled:opacity-40"
            >
              {busy === "committing" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setResult(null);
                setRows(null);
              }}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <Sheet
        open={dialog === "problems"}
        onClose={() => setDialog(null)}
        title={`${fileName ?? "This file"} can't be saved`}
        description={
          problemNote ??
          (result ? `${result.errorCount} problem${result.errorCount === 1 ? "" : "s"} to fix in the file, then upload it again. Nothing has been saved.` : undefined)
        }
        size="2xl"
        footer={
          <button type="button" onClick={() => setDialog(null)} className="min-h-11 w-full rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-200 hover:bg-white/10">
            Close
          </button>
        }
      >
        {issues.length > 0 ? <IssuesTable issues={issues} className="max-h-[60dvh]" /> : <p className="text-sm text-gray-300">{problemNote}</p>}
      </Sheet>

      <Sheet
        open={dialog === "changes"}
        onClose={() => setDialog(null)}
        title="This upload changes saved data"
        description={
          result
            ? `${result.counts.inserts} new row${result.counts.inserts === 1 ? "" : "s"} will be added. ${result.changeCount} saved ${result.changeCount === 1 ? "entry changes" : "entries change"}:`
            : undefined
        }
        size="2xl"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setDialog(null)}
              className="min-h-11 flex-1 rounded-lg border border-white/15 px-4 py-2 text-sm text-gray-200 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy !== null || !canCommit}
              onClick={() => commit(true)}
              className="min-h-11 flex-1 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300 disabled:opacity-40"
            >
              {busy === "committing" ? "Saving…" : "Save anyway"}
            </button>
          </div>
        }
      >
        {result && (
          <div className="max-h-[60dvh] overflow-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-800 text-gray-400">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Saved entry</th>
                  <th className="px-3 py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {result.changes.map((c, n) => (
                  <tr key={n} className="border-t border-white/5">
                    <td className="px-3 py-1.5 text-gray-400">{c.row || "—"}</td>
                    <td className="px-3 py-1.5 text-gray-200">{c.item}</td>
                    <td className={`px-3 py-1.5 ${c.change === "removed" ? "text-red-300" : "text-amber-300"}`}>{c.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.changeCount > result.changes.length && (
              <p className="px-3 py-2 text-xs text-gray-500">…and {result.changeCount - result.changes.length} more.</p>
            )}
          </div>
        )}
      </Sheet>
    </section>
  );
}
