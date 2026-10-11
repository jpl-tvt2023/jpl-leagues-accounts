/**
 * Shared constants for the test harness.
 *
 * Test superadmin matches what scripts/test-reset.ts seeds. Nobody has a password: specs sign in
 * through the test-only POST /api/test-auth/signin (TEST_AUTH_ENABLED=1, set in .env.test).
 */

export const TEST_SUPERADMIN = {
  email: "test-super@jpl.local",
} as const;

/**
 * Team keys auto-created by POST /api/superadmin/leagues (see the team-creation loop in
 * src/app/api/superadmin/leagues/route.ts): `${slug}-Team${i}` for i = 1..teamSize. The key is
 * an internal identifier, not a login; specs use it to find a team.
 */
export function teamLoginId(slug: string, index: number): string {
  return `${slug}-Team${index}`;
}

/**
 * The test person who owns team `index` of a league. Each team gets its own person, so a spec
 * that signs in "as team N" is that team's owner — and on no other team.
 */
export function teamPersonEmail(slug: string, index: number): string {
  return `${teamLoginId(slug, index).toLowerCase()}@teams.test`;
}
