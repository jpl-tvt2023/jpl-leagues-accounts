"use client";

import { useState } from "react";

/** One of the person's saved FPL teams (GET /api/me/fpl-teams, or setup's `fplTeams`). */
export interface FplTeamOption {
  id: string;
  fplEntryId: string;
  teamName: string | null;
  managerName: string | null;
  /** The person's primary FPL team: picked for them by default. */
  isPrimary?: boolean;
  /** In a league: the other team it already plays for there, which makes it unpickable. */
  takenBy?: string | null;
}

const INPUT = "w-full rounded-lg border border-white/20 bg-black/40 px-4 py-3 text-white placeholder-gray-500 focus:border-yellow-400 focus:outline-none";

export function PrimaryBadge() {
  return <span className="shrink-0 rounded-full bg-yellow-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-300">Primary</span>;
}

/** Which saved FPL team to pick by default: the primary, unless it plays for another team here. */
export function defaultFplPick(teams: FplTeamOption[]): string | null {
  const pickable = teams.filter((t) => !t.takenBy);
  return (pickable.find((t) => t.isPrimary) ?? pickable[0])?.fplEntryId ?? null;
}

export function fplTeamLabel(t: Pick<FplTeamOption, "fplEntryId" | "teamName" | "managerName">): string {
  return t.teamName ? `${t.teamName}${t.managerName ? ` · ${t.managerName}` : ""}` : `FPL team ${t.fplEntryId}`;
}

/**
 * Save an FPL team to the person's list: the ID, a preview of whose team it is (checked against
 * FPL when the field is left), then Add. Calls `onAdded` with the saved team.
 */
export function AddFplTeamForm({ onAdded, autoFocus = false }: { onAdded: (team: FplTeamOption) => void; autoFocus?: boolean }) {
  const [id, setId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setPreview(null);
    if (!id) return;
    const res = await fetch(`/api/me/profile?checkFplEntry=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => null);
    if (res?.found) setPreview(`${res.teamName} — ${res.managerName}`);
    else if (res?.problem) setPreview(res.problem);
  };

  const add = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/me/fpl-teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fplEntryId: id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Couldn't add that FPL team.");
    setId("");
    setPreview(null);
    onAdded(body.fplTeam);
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={id}
          onChange={(e) => setId(e.target.value.replace(/\D/g, ""))}
          onBlur={check}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          inputMode="numeric"
          maxLength={10}
          placeholder="FPL team ID, e.g. 1234567"
          aria-label="FPL team ID"
          autoFocus={autoFocus}
          className={INPUT}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !id}
          className="shrink-0 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-yellow-400 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : (
          (preview ?? (
            <>
              The number in your FPL team&apos;s web address at{" "}
              <a href="https://fantasy.premierleague.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                fantasy.premierleague.com
              </a>
            </>
          ))
        )}
      </p>
    </div>
  );
}

/**
 * Pick which of your saved FPL teams plays for you in a league. One already playing for another
 * team in that league is shown but can't be picked. "Add an FPL team" saves a new one to your
 * list (it's then picked) without leaving the page.
 */
export function FplTeamPicker({
  teams,
  selected,
  onSelect,
  onAdded,
  disabled = false,
}: {
  teams: FplTeamOption[];
  /** The picked FPL entry id. */
  selected: string | null;
  onSelect: (fplEntryId: string) => void;
  onAdded: (team: FplTeamOption) => void;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(teams.length === 0);

  return (
    <div className="space-y-3">
      {teams.length > 0 && (
        <fieldset disabled={disabled} className="space-y-2">
          <legend className="sr-only">Your FPL teams</legend>
          {teams.map((t) => {
            const taken = !!t.takenBy;
            return (
              <label
                key={t.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
                  selected === t.fplEntryId ? "border-yellow-400/70 bg-yellow-400/10" : "border-white/10 bg-black/30"
                } ${taken ? "opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="radio"
                  name="fpl-team"
                  value={t.fplEntryId}
                  checked={selected === t.fplEntryId}
                  disabled={taken}
                  onChange={() => onSelect(t.fplEntryId)}
                />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold text-white">{fplTeamLabel(t)}</span>
                    {t.isPrimary && <PrimaryBadge />}
                  </span>
                  <span className="block truncate text-xs text-gray-400">
                    ID {t.fplEntryId}
                    {taken && ` · plays for ${t.takenBy} in this league`}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {!disabled &&
        (adding ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-sm font-semibold text-white">{teams.length === 0 ? "Add the FPL team you'll play with" : "Add another FPL team"}</p>
            <AddFplTeamForm
              autoFocus={teams.length > 0}
              onAdded={(team) => {
                setAdding(false);
                onAdded(team);
              }}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-sm text-yellow-400 underline hover:text-yellow-300">
            + Add another FPL team
          </button>
        ))}
    </div>
  );
}
