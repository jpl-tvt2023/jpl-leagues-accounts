/**
 * Classic Cricket Auction scoring. Pure — no DB — so it is unit-tested directly.
 *
 * Every player in a squad scores all their points. A player from the franchise their manager owns
 * scores extra: `points × boost%` on top (applied to the total, so negative points get more
 * negative too). There are no gameweeks and no processing step: standings are computed from the
 * uploaded points whenever they're asked for (and cached by the caller).
 *
 * Tiebreakers, in order: total points, synergy (boost) points, the team's highest-scoring player,
 * purse remaining. Teams still level share the rank.
 */

export interface ScoringTeam {
  id: string;
  name: string;
  purse: number;
}

export interface ScoringPlayer {
  id: number;
  /** The player's real team (cricket_teams.id). */
  teamId: number;
}

export interface ScoringFixture {
  id: number;
  status: "scheduled" | "completed" | "abandoned";
  pointsUploadedAt: Date | null;
}

export interface ScoringInput {
  teams: ScoringTeam[];
  squads: Array<{ teamId: string; playerId: number }>;
  /** Franchise (real team id) each manager owns, if any. */
  franchises: Array<{ teamId: string; cricketTeamId: number }>;
  players: ScoringPlayer[];
  points: Array<{ fixtureId: number; playerId: number; points: number }>;
  fixtures: ScoringFixture[];
  boostPercent: number;
  /** The admin's "Mark complete", if set. */
  completedAt: Date | null;
}

export interface PlayerScore {
  playerId: number;
  raw: number;
  synergy: number;
  total: number;
  /** Fixtures with a points row for this player. */
  matches: number;
  /** True when this player gets the franchise boost. */
  boosted: boolean;
}

export interface FixtureScore {
  fixtureId: number;
  raw: number;
  synergy: number;
  total: number;
}

export interface StandingRow {
  teamId: string;
  name: string;
  raw: number;
  synergy: number;
  total: number;
  purse: number;
  /** The squad's best player total (boost included); 0 for an empty squad. */
  topScore: number;
  topScorerId: number | null;
  rank: number;
  /** Shares its rank with another team after every tiebreaker. */
  tied: boolean;
  players: PlayerScore[];
  fixtures: FixtureScore[];
}

export interface Standings {
  rows: StandingRow[];
  fixturesTotal: number;
  fixturesScored: number;
  complete: boolean;
}

/** Points are stored as REAL; keep two decimals so float noise never decides a tiebreak. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function compareStandings(a: StandingRow, b: StandingRow): number {
  return b.total - a.total || b.synergy - a.synergy || b.topScore - a.topScore || b.purse - a.purse;
}

export function computeCricketStandings(input: ScoringInput): Standings {
  const factor = input.boostPercent / 100;
  const playerTeam = new Map(input.players.map((p) => [p.id, p.teamId]));
  const ownedFranchises = new Map<string, Set<number>>();
  for (const f of input.franchises) {
    const set = ownedFranchises.get(f.teamId) ?? new Set<number>();
    set.add(f.cricketTeamId);
    ownedFranchises.set(f.teamId, set);
  }
  const pointsByPlayer = new Map<number, Array<{ fixtureId: number; points: number }>>();
  for (const p of input.points) {
    const list = pointsByPlayer.get(p.playerId) ?? [];
    list.push({ fixtureId: p.fixtureId, points: p.points });
    pointsByPlayer.set(p.playerId, list);
  }
  const squadByTeam = new Map<string, number[]>();
  for (const s of input.squads) {
    const list = squadByTeam.get(s.teamId) ?? [];
    list.push(s.playerId);
    squadByTeam.set(s.teamId, list);
  }

  const rows: StandingRow[] = input.teams.map((team) => {
    const franchises = ownedFranchises.get(team.id) ?? new Set<number>();
    const byFixture = new Map<number, FixtureScore>();
    const players: PlayerScore[] = (squadByTeam.get(team.id) ?? []).map((playerId) => {
      const boosted = franchises.has(playerTeam.get(playerId) ?? -1) && factor !== 0;
      let raw = 0;
      let synergy = 0;
      const rows = pointsByPlayer.get(playerId) ?? [];
      for (const r of rows) {
        const extra = boosted ? r.points * factor : 0;
        raw += r.points;
        synergy += extra;
        const f = byFixture.get(r.fixtureId) ?? { fixtureId: r.fixtureId, raw: 0, synergy: 0, total: 0 };
        f.raw += r.points;
        f.synergy += extra;
        byFixture.set(r.fixtureId, f);
      }
      return { playerId, raw: round2(raw), synergy: round2(synergy), total: round2(raw + synergy), matches: rows.length, boosted };
    });
    players.sort((a, b) => b.total - a.total || a.playerId - b.playerId);
    const raw = round2(players.reduce((s, p) => s + p.raw, 0));
    const synergy = round2(players.reduce((s, p) => s + p.synergy, 0));
    const top = players[0];
    return {
      teamId: team.id,
      name: team.name,
      raw,
      synergy,
      total: round2(raw + synergy),
      purse: team.purse,
      topScore: top ? top.total : 0,
      topScorerId: top ? top.playerId : null,
      rank: 0,
      tied: false,
      players,
      fixtures: [...byFixture.values()]
        .map((f) => ({ fixtureId: f.fixtureId, raw: round2(f.raw), synergy: round2(f.synergy), total: round2(f.raw + f.synergy) }))
        .sort((a, b) => a.fixtureId - b.fixtureId),
    };
  });

  rows.sort((a, b) => compareStandings(a, b) || a.name.localeCompare(b.name));
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    row.rank = prev && compareStandings(prev, row) === 0 ? prev.rank : i + 1;
    row.tied = (!!prev && compareStandings(prev, row) === 0) || (!!next && compareStandings(row, next) === 0);
  });

  const counted = input.fixtures.filter((f) => f.status !== "abandoned");
  const scored = counted.filter((f) => f.pointsUploadedAt !== null).length;
  return {
    rows,
    fixturesTotal: counted.length,
    fixturesScored: scored,
    complete: input.completedAt !== null || (counted.length > 0 && scored === counted.length),
  };
}
