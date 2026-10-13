"use client";

import { useEffect, useState } from "react";
import { formatLakhs } from "@/lib/format/currency";
import type { ManagerTeamRow } from "@/lib/sports/cricket/admin";

const INPUT = "rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white focus:border-yellow-500 focus:outline-none";

/**
 * Manager Management: every team, who manages it, its money, squad and franchise, and renaming.
 * Teams are made with the league; people join them through the invite link (Members tab).
 */
export function CricketManagersTab({ leagueId, onMessage }: { leagueId: string; onMessage: (m: { type: "success" | "error"; text: string }) => void }) {
  const [rows, setRows] = useState<ManagerTeamRow[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/${leagueId}/cricket/teams`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (res.ok) setRows(body.teams);
      else onMessage({ type: "error", text: body.error ?? "Couldn't load the teams" });
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, onMessage]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/${leagueId}/cricket/teams`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: editing.id, name: editing.name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onMessage({ type: "error", text: body.error ?? "Couldn't rename the team" });
        return;
      }
      setRows(body.teams);
      setEditing(null);
      onMessage({ type: "success", text: "Team renamed." });
    } finally {
      setSaving(false);
    }
  };

  if (!rows) return <p className="text-sm text-gray-400">Loading teams…</p>;
  const unclaimed = rows.filter((t) => t.managers.length === 0).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Manager Management</h2>
          <p className="mt-1 text-sm text-gray-400">
            {rows.length} teams{unclaimed > 0 && ` · ${unclaimed} still waiting for a manager — share the invite link from the Members tab`}.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-gray-400">
            <tr className="border-b border-white/10">
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Managers</th>
              <th className="px-4 py-3">Franchise</th>
              <th className="px-4 py-3 text-right">Squad</th>
              <th className="px-4 py-3 text-right">Spent</th>
              <th className="px-4 py-3 text-right">Purse left</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-white/5 align-top">
                <td className="px-4 py-3 text-white">
                  {editing?.id === t.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && save()}
                        aria-label={`New name for ${t.name}`}
                        maxLength={60}
                        className={INPUT}
                        autoFocus
                      />
                      <button type="button" disabled={saving} onClick={save} className="rounded-lg bg-yellow-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50">
                        Save
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-semibold">{t.name}</span>
                      {t.franchise && <p className="text-xs text-gray-500">Shown as {t.franchise.name} (its franchise)</p>}
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">
                  {t.managers.length === 0 ? (
                    <span className="text-amber-300">No one yet</span>
                  ) : (
                    t.managers.map((m) => (
                      <div key={m.userId}>
                        {m.name}
                        {m.username && <span className="text-gray-500"> @{m.username}</span>}
                        {m.role === "owner" && <span className="ml-1 rounded bg-yellow-500/20 px-1 text-[10px] text-yellow-300">owner</span>}
                      </div>
                    ))
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">{t.franchise ? `${t.franchise.code} — ${t.franchise.name}` : "—"}</td>
                <td className="px-4 py-3 text-right text-gray-300">
                  {t.squadSize}
                  {t.penaltySlots > 0 && <span className="block text-xs text-amber-300">{t.penaltySlots} penalty</span>}
                </td>
                <td className="px-4 py-3 text-right text-gray-300">{formatLakhs(t.spent)}</td>
                <td className="px-4 py-3 text-right font-semibold text-white">{formatLakhs(t.purse)}</td>
                <td className="px-4 py-3 text-right">
                  {editing?.id !== t.id && (
                    <button type="button" onClick={() => setEditing({ id: t.id, name: t.name })} className="text-sm text-yellow-300 hover:underline">
                      Rename
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
