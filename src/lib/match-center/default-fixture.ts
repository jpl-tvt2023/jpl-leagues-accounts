/**
 * Which match the Match Center opens on when it's reached from the nav rather than from a fixture.
 *
 * Pure (no database) so it unit-tests in `tests/unit/match-center-default.test.ts`.
 */

export interface DefaultFixtureCandidate {
  id: string;
  gw: number;
  /** Deadline of the fixture's gameweek. */
  deadline: Date;
  homeTeamId: string;
  awayTeamId: string;
  /** League fixtures only — Continental cup fixtures aren't Match Center comparisons. */
  isLeagueFixture: boolean;
  isChallenge: boolean;
}

/**
 * The gameweek in play is the latest one whose deadline has passed (it's live or just finished);
 * before the season starts, the first one. In that gameweek: the viewer's own match if they have
 * one, otherwise the gameweek's first match. A viewer with no match in it (eliminated, a blank
 * week) gets their most recent match instead. Null when the league has no league fixtures.
 */
export function pickDefaultFixture(
  candidates: DefaultFixtureCandidate[],
  now: Date,
  viewerTeamId: string | null,
): DefaultFixtureCandidate | null {
  const pool = candidates.filter((c) => c.isLeagueFixture);
  if (pool.length === 0) return null;

  const started = pool.filter((c) => c.deadline.getTime() <= now.getTime());
  const gw = started.length > 0 ? Math.max(...started.map((c) => c.gw)) : Math.min(...pool.map((c) => c.gw));

  // Regular fixtures before challenge ones; then a stable order.
  const order = (a: DefaultFixtureCandidate, b: DefaultFixtureCandidate) =>
    Number(a.isChallenge) - Number(b.isChallenge) || a.id.localeCompare(b.id);
  const involves = (c: DefaultFixtureCandidate) => !!viewerTeamId && (c.homeTeamId === viewerTeamId || c.awayTeamId === viewerTeamId);

  const inGw = pool.filter((c) => c.gw === gw).sort(order);
  if (viewerTeamId) {
    const mine = inGw.find(involves);
    if (mine) return mine;
    const latestMine = pool
      .filter((c) => involves(c) && c.gw <= gw)
      .sort((a, b) => b.gw - a.gw || order(a, b))[0];
    if (latestMine) return latestMine;
  }
  return inGw[0] ?? null;
}
