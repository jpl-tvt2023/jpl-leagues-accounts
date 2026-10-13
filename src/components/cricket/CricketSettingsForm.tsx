"use client";

import { useEffect, useState } from "react";
import { formatLakhs } from "@/lib/format/currency";
import { ROLES, ROLE_LABELS, squadRulesErrors, type SquadRules } from "@/lib/sports/cricket/squad-rules";
import type { CricketLeagueSettings } from "@/lib/sports/cricket/league-settings";

interface TournamentOption {
  id: string;
  name: string;
  kind: "league" | "window";
  status: "draft" | "ready" | "archived";
  teams: number;
  players: number;
  fixtures: number;
}

const input = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white focus:border-yellow-500 focus:outline-none";

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  hint,
  optional,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min?: number;
  step?: number;
  hint?: string;
  /** Blank means "no limit" (null). */
  optional?: boolean;
}) {
  return (
    <label className="block text-sm text-gray-300">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={value ?? ""}
        placeholder={optional ? "No limit" : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(optional ? null : min);
          else onChange(Number(raw));
        }}
        className={`mt-1 ${input}`}
      />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

/**
 * A cricket league's settings: tournament, purse, squad rules, franchise auction and timers.
 * `tournamentLocked` hides the tournament picker (it can't change once a league exists).
 */
export function CricketSettingsForm({
  value,
  onChange,
  managers,
  onManagers,
  tournamentLocked = false,
}: {
  value: CricketLeagueSettings;
  onChange: (next: CricketLeagueSettings) => void;
  /** Number of managers; omitted where it can't be edited (the admin console). */
  managers?: number;
  onManagers?: (n: number) => void;
  tournamentLocked?: boolean;
}) {
  const [tournaments, setTournaments] = useState<TournamentOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/superadmin/cricket/tournaments");
      const data = await res.json().catch(() => ({}));
      if (!cancelled) setTournaments(res.ok ? (data.tournaments as TournamentOption[]).filter((t) => t.status !== "archived") : []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tournament = tournaments?.find((t) => t.id === value.tournamentId) ?? null;
  const rules = value.squadRules;
  const setRules = (patch: Partial<SquadRules>) => onChange({ ...value, squadRules: { ...rules, ...patch } });
  const ruleErrors = squadRulesErrors(rules);

  return (
    <div className="space-y-5">
      {!tournamentLocked && (
        <label className="block text-sm text-gray-300">
          Tournament
          <select
            value={value.tournamentId}
            onChange={(e) => {
              const next = tournaments?.find((t) => t.id === e.target.value);
              onChange({ ...value, tournamentId: e.target.value, franchiseAuctionEnabled: next?.kind === "league" ? value.franchiseAuctionEnabled : false });
            }}
            className={`mt-1 ${input}`}
          >
            <option value="" className="bg-slate-800">
              {tournaments === null ? "Loading…" : tournaments.length ? "Pick a tournament" : "No tournaments yet — create one under Cricket Data"}
            </option>
            {tournaments?.map((t) => (
              <option key={t.id} value={t.id} className="bg-slate-800">
                {t.name} — {t.players} players, {t.fixtures} fixtures{t.status === "draft" ? " (draft)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {managers !== undefined && onManagers && (
          <NumberField label="Number of managers" value={managers} min={2} onChange={(v) => onManagers(v ?? 2)} />
        )}
        {/* The browser only accepts min + k × step, so min must be a multiple of step: any multiple
            of ₹5 L (the smallest bid step) — 10000 = ₹100 Cr — is valid. */}
        <NumberField
          label="Purse per team (lakhs)"
          value={value.purse}
          min={5}
          step={5}
          hint={formatLakhs(value.purse)}
          onChange={(v) => onChange({ ...value, purse: v ?? 1 })}
        />
        <NumberField
          label="Penalty redeem price (lakhs)"
          value={value.penaltyRedeemPrice}
          step={5}
          hint={`${formatLakhs(value.penaltyRedeemPrice)} to clear one missed-nomination penalty`}
          onChange={(v) => onChange({ ...value, penaltyRedeemPrice: v ?? 0 })}
        />
      </div>

      <fieldset className="rounded-xl border border-white/10 p-4">
        <legend className="px-1 text-sm font-semibold text-white">Squad</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          <NumberField label="Min players" value={rules.minSize} min={1} onChange={(v) => setRules({ minSize: v ?? 1 })} />
          <NumberField label="Max players" value={rules.maxSize} min={1} onChange={(v) => setRules({ maxSize: v ?? 1 })} />
          <NumberField
            label="Max per real team"
            optional
            value={rules.maxPerRealTeam}
            min={1}
            onChange={(v) => setRules({ maxPerRealTeam: v })}
          />
          <NumberField label="Max overseas" optional value={rules.maxOverseas} onChange={(v) => setRules({ maxOverseas: v })} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r} className="space-y-2">
              <NumberField
                label={`${ROLE_LABELS[r]} min`}
                value={rules.roleMin[r]}
                onChange={(v) => setRules({ roleMin: { ...rules.roleMin, [r]: v ?? 0 } })}
              />
              <NumberField
                label={`${ROLE_LABELS[r]} max`}
                optional
                value={rules.roleMax[r]}
                onChange={(v) => setRules({ roleMax: { ...rules.roleMax, [r]: v } })}
              />
            </div>
          ))}
        </div>
        {ruleErrors.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-red-300">
            {ruleErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="rounded-xl border border-white/10 p-4">
        <legend className="px-1 text-sm font-semibold text-white">Franchise auction</legend>
        <label className={`flex items-start gap-3 text-sm ${tournament && tournament.kind !== "league" ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            disabled={!!tournament && tournament.kind !== "league"}
            checked={value.franchiseAuctionEnabled}
            onChange={(e) => onChange({ ...value, franchiseAuctionEnabled: e.target.checked })}
            className="mt-1 h-4 w-4 accent-yellow-400"
          />
          <span className="text-gray-300">
            Before the player auction, each manager buys one franchise from the same purse. Players from the franchise a
            manager owns score extra. {tournament && tournament.kind !== "league" && "Only league tournaments have franchises."}
          </span>
        </label>
        {value.franchiseAuctionEnabled && (
          <div className="mt-4 max-w-xs">
            <NumberField
              label="Franchise boost (%)"
              value={value.franchiseBoostPercent}
              hint={`Own-franchise players score ×${(1 + value.franchiseBoostPercent / 100).toFixed(2)}`}
              onChange={(v) => onChange({ ...value, franchiseBoostPercent: v ?? 0 })}
            />
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Bid timer (seconds)"
          value={value.bidTimerSeconds}
          min={5}
          onChange={(v) => onChange({ ...value, bidTimerSeconds: v ?? 20 })}
        />
        <NumberField
          label="Nomination timer (seconds)"
          value={value.nominationTimeoutSeconds}
          min={10}
          onChange={(v) => onChange({ ...value, nominationTimeoutSeconds: v ?? 60 })}
        />
      </div>
    </div>
  );
}
