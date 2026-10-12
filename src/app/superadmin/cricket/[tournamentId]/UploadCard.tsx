"use client";

import { useRef, useState } from "react";
import { SHEET_COLUMNS } from "@/lib/sports/cricket/sheets/columns";
import { SHEET_TITLES } from "@/lib/sports/cricket/sheets/templates";
import { downloadTemplate, readSheetFile } from "@/lib/sports/cricket/sheets/client";
import type { RawRow, SheetIssue, SheetKind } from "@/lib/sports/cricket/sheets/types";

interface UploadResult {
  kind: SheetKind;
  committed: boolean;
  counts: { rows: number; inserts: number; updates: number; deletes: number; unchanged: number; fixtures?: number; replacedRows?: number };
  issues: SheetIssue[];
  errorCount: number;
  warningCount: number;
  overridableCount: number;
  canCommit: boolean;
  preview: Array<Record<string, string | number | boolean | null>>;
  validationHash: string;
}

const INTRO: Record<SheetKind, string> = {
  teams: "The full list of teams (IPL franchises, or countries). Replaces the current list.",
  players: "The full player list. Replaces the current list; players keep their place in squads as long as their player_id stays the same.",
  fixtures: "The full fixture list. Fixture ids restart at 1 in each series. Replaces the current list.",
  points: "Fantasy points for one or more fixtures. Each fixture in the file has all its points replaced; other fixtures are untouched.",
};

function countsLine(kind: SheetKind, c: UploadResult["counts"]): string {
  if (kind === "points") {
    return `${c.inserts} points rows for ${c.fixtures ?? 0} fixture(s)` + (c.replacedRows ? ` — replacing ${c.replacedRows} existing rows` : "");
  }
  return `${c.inserts} new · ${c.updates} changed · ${c.deletes} removed · ${c.unchanged} unchanged`;
}

/** One sheet: template download, file pick, server validation preview, then commit. */
export function UploadCard({ tournamentId, kind, onCommitted }: { tournamentId: string; kind: SheetKind; onCommitted: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState<"reading" | "validating" | "committing" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const call = async (mode: "validate" | "commit", sheetRows: RawRow[], hash?: string) => {
    const res = await fetch(`/api/superadmin/cricket/tournaments/${tournamentId}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, mode, rows: sheetRows, fileName, validationHash: hash, override }),
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
      if (!ok) setMessage({ tone: "error", text: data.error ?? "Validation failed" });
      else setResult(data);
    } catch (err) {
      setMessage({ tone: "error", text: `Couldn't read that file: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const commit = async () => {
    if (!rows || !result) return;
    setBusy("committing");
    setMessage(null);
    try {
      const { ok, status, data } = await call("commit", rows, result.validationHash);
      if (ok) {
        setMessage({ tone: "success", text: `Saved: ${countsLine(kind, data.counts)}.` });
        setResult(null);
        setRows(null);
        onCommitted();
        return;
      }
      if (data.result) setResult(data.result);
      setMessage({ tone: "error", text: status === 409 ? `${data.error} Pick the file again.` : data.error ?? "Commit failed" });
    } finally {
      setBusy(null);
    }
  };

  const canCommit = !!result && (result.canCommit || (override && result.errorCount === result.overridableCount));
  const previewColumns = result?.preview[0] ? Object.keys(result.preview[0]) : [];
  const issues = result ? [...result.issues].sort((a, b) => (a.level === b.level ? a.row - b.row : a.level === "error" ? -1 : 1)) : [];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{SHEET_TITLES[kind]}</h3>
          <p className="mt-1 max-w-xl text-sm text-gray-400">{INTRO[kind]}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => downloadTemplate(kind)}
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

      <details className="mt-3 text-xs text-gray-400">
        <summary className="cursor-pointer select-none text-gray-300">Columns</summary>
        <ul className="mt-2 space-y-1">
          {SHEET_COLUMNS[kind].map((c) => (
            <li key={c.field}>
              <code className="rounded bg-white/10 px-1 text-gray-200">{c.header}</code>
              {c.required ? "" : " (optional)"} — {c.help}
            </li>
          ))}
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

          {issues.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-lg border border-white/10">
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
          )}

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
              onClick={commit}
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
    </section>
  );
}
