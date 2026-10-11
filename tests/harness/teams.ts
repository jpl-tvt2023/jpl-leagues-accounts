/**
 * Team-level harness: puts a test person on each team and completes the /[league]/setup wizard
 * through its API, so specs can jump straight into captain/chip/auction flows.
 *
 * After league creation every team is open (nobody on it) and has `isProfileComplete: false`.
 * Without this helper, every spec would have to drive joining and setup per team — slow and noisy.
 */

import type { APIRequestContext } from "@playwright/test";
import { teamLoginId } from "./constants";
import { apiSignInTeam, apiSignOut } from "./auth";

export interface TeamHandle {
  index: number;
  /** The team key (internal identifier, not a login). */
  loginId: string;
  /** Team display name after setup (`Team N` if no override). */
  name: string;
}

async function completeSetup(request: APIRequestContext, slug: string, data: Record<string, string>, who: string) {
  const setup = await request.post(`/api/team/setup?league=${encodeURIComponent(slug)}`, {
    data,
    failOnStatusCode: false,
  });
  if (!setup.ok()) {
    const body = await setup.json().catch(() => ({}));
    throw new Error(`${who}: setup failed: ${setup.status()} ${body?.error ?? ""}`);
  }
}

/**
 * For a TVT or Continental Championship team: sign in as its owner and complete setup with
 * deterministic FPL IDs.
 *
 * `fplBase` is the starting FPL element ID; team i gets (fplBase + 2i, fplBase + 2i + 1)
 * so every team in a league has a unique pair without colliding across teams.
 */
export async function setupTvtTeam(
  request: APIRequestContext,
  slug: string,
  index: number,
  opts: { teamName?: string; fplBase?: number } = {},
): Promise<TeamHandle> {
  const loginId = teamLoginId(slug, index);
  const teamName = opts.teamName ?? `Team ${index}`;
  const fplBase = opts.fplBase ?? 1000;

  await apiSignInTeam(request, slug, index);
  await completeSetup(
    request,
    slug,
    {
      teamName,
      player1Name: `${teamName} P1`,
      player1FplId: String(fplBase + index * 2),
      player2Name: `${teamName} P2`,
      player2FplId: String(fplBase + index * 2 + 1),
    },
    `setupTvtTeam(${loginId})`,
  );

  await apiSignOut(request);
  return { index, loginId, name: teamName };
}

/**
 * Auction-league team setup. Same as TVT but the setup endpoint skips the FPL
 * IDs (auction leagues don't have player rows — squads come from bidding).
 */
export async function setupAuctionTeam(
  request: APIRequestContext,
  slug: string,
  index: number,
  opts: { teamName?: string } = {},
): Promise<TeamHandle> {
  const loginId = teamLoginId(slug, index);
  const teamName = opts.teamName ?? `Team ${index}`;

  await apiSignInTeam(request, slug, index);
  await completeSetup(
    request,
    slug,
    // Auction setup ignores player fields; pass empty strings to match real client.
    { teamName, player1Name: "", player1FplId: "", player2Name: "", player2FplId: "" },
    `setupAuctionTeam(${loginId})`,
  );

  await apiSignOut(request);
  return { index, loginId, name: teamName };
}

/** Set up every team in a league sequentially. Returns ordered handles. */
export async function setupAllTeams(
  request: APIRequestContext,
  slug: string,
  count: number,
  format: "tvt" | "continental-championship" | "auction",
  opts: { fplBase?: number } = {},
): Promise<TeamHandle[]> {
  const setup = format === "auction" ? setupAuctionTeam : setupTvtTeam;
  const handles: TeamHandle[] = [];
  for (let i = 1; i <= count; i++) {
    handles.push(await setup(request, slug, i, { fplBase: opts.fplBase }));
  }
  return handles;
}
