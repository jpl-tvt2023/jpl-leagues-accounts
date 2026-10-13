/**
 * Matching what people type into the sheets to the tournament's records. Scores are entered by
 * hand, so uploads name players and teams the way a person would — "Virat Kohli", "RCB" or "Royal
 * Challengers Bengaluru" — never by internal id. Matching is exact after normalising case, spaces
 * and punctuation; anything else is an error with a suggestion, never a guess. Pure.
 */

import { cellText, normalizeTeamCode } from "./columns";

/** "  Faf du Plessis. " → "faf du plessis"; accents, dots and apostrophes are dropped. */
export function normalizeName(value: unknown): string {
  return cellText(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A player_id made from a name: "Virat Kohli" → "virat-kohli". */
export function slugifyName(value: unknown): string {
  return normalizeName(value).replace(/ /g, "-");
}

/** Levenshtein distance, for "did you mean". */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** The closest of `candidates` to `typed`, if it's close enough to be a plausible typo. */
function closest<T>(typed: string, candidates: T[], key: (c: T) => string): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(typed, key(c));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best && bestD <= Math.max(2, Math.floor(typed.length / 3)) ? best : null;
}

/** Teams by code or full name. */
export class TeamLookup {
  private readonly byKey = new Map<string, string>();
  readonly size: number;

  constructor(private readonly teams: Array<{ code: string; name?: string | null }>) {
    for (const t of teams) {
      this.byKey.set(`code:${normalizeTeamCode(t.code)}`, t.code);
      if (t.name) this.byKey.set(`name:${normalizeName(t.name)}`, t.code);
    }
    this.size = teams.length;
  }

  /** The team code a cell refers to (code or full name), or null. */
  resolve(value: unknown): string | null {
    return this.byKey.get(`code:${normalizeTeamCode(value)}`) ?? this.byKey.get(`name:${normalizeName(value)}`) ?? null;
  }

  /** "Team X isn't in the Teams sheet", with a suggestion when one is close. */
  unknownMessage(value: unknown): string {
    const typed = cellText(value);
    const near = closest(normalizeName(typed), this.teams, (t) => normalizeName(t.name ?? t.code));
    return `Team "${typed}" isn't in the Teams sheet${near ? ` — did you mean ${near.code}${near.name ? ` (${near.name})` : ""}?` : ""}`;
  }
}

export interface NamedPlayer {
  id: number;
  code: string;
  name: string;
  teamId: number;
}

/** Players by name within a team, or by player_id. */
export class PlayerLookup<P extends NamedPlayer> {
  private readonly byCode: Map<string, P>;
  private readonly byTeamName = new Map<string, P[]>();
  private readonly byName = new Map<string, P[]>();

  constructor(private readonly players: P[]) {
    this.byCode = new Map(players.map((p) => [p.code, p]));
    for (const p of players) {
      const n = normalizeName(p.name);
      const k = `${p.teamId}:${n}`;
      this.byTeamName.set(k, [...(this.byTeamName.get(k) ?? []), p]);
      this.byName.set(n, [...(this.byName.get(n) ?? []), p]);
    }
  }

  code(code: string): P | undefined {
    return this.byCode.get(code);
  }

  /**
   * The player called `name` in team `teamId`. Unknown and ambiguous names are errors; the message
   * says whether the name belongs to another team or what it was probably meant to be.
   */
  resolve(teamId: number, name: string, teamLabel: (teamId: number) => string): { player: P } | { error: string } {
    const n = normalizeName(name);
    const hits = this.byTeamName.get(`${teamId}:${n}`) ?? [];
    if (hits.length === 1) return { player: hits[0] };
    if (hits.length > 1) return { error: `${hits.length} ${teamLabel(teamId)} players are called "${name}" — give the player_id (${hits.map((h) => h.code).join(" or ")})` };
    const elsewhere = this.byName.get(n) ?? [];
    if (elsewhere.length) return { error: `${name} plays for ${elsewhere.map((p) => teamLabel(p.teamId)).join(" / ")}, not ${teamLabel(teamId)}` };
    const near = closest(n, this.players.filter((p) => p.teamId === teamId), (p) => normalizeName(p.name));
    return { error: `No ${teamLabel(teamId)} player called "${name}"${near ? ` — did you mean ${near.name}?` : ""}` };
  }
}
