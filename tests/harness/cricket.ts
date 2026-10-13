/**
 * Cricket helpers: a small fixed tournament dataset and the upload round-trip (validate → commit)
 * through the real superadmin API, exactly as the upload page does it.
 */

import { expect, type APIRequestContext } from "@playwright/test";

type Row = Record<string, string | number>;

/** 4 teams, 6 players each (WK, 2 BAT, AR, 2 BOWL), a round-robin of 6 fixtures. */
export const MINI_CRICKET = {
  teams: [
    { team_code: "MI", name: "Mumbai Indians", base_price: 1000 },
    { team_code: "CSK", name: "Chennai Super Kings", base_price: 1200 },
    { team_code: "RCB", name: "Royal Challengers Bengaluru", base_price: 800 },
    { team_code: "KKR", name: "Kolkata Knight Riders", base_price: 900 },
  ] as Row[],
  players: ["MI", "CSK", "RCB", "KKR"].flatMap((team, t) =>
    ["WK", "BAT", "BAT", "AR", "BOWL", "BOWL"].map((role, i) => ({
      player_id: `${team}${i + 1}`,
      name: `${team} Player ${i + 1}`,
      team,
      role,
      base_price: 50 + 25 * ((i + t) % 4),
      overseas: i === 3 ? "Y" : "N",
      Test: "",
      ODI: "",
      T20: 3,
    })),
  ) as Row[],
  fixtures: [
    ["MI", "CSK"],
    ["RCB", "KKR"],
    ["MI", "RCB"],
    ["CSK", "KKR"],
    ["MI", "KKR"],
    ["CSK", "RCB"],
  ].map(([a, b], i) => ({
    series: "Mini Cup",
    fixture_id: i + 1,
    format: "T20",
    team_a: a,
    team_b: b,
    start_time_ist: `2026-04-${String(i + 1).padStart(2, "0")} 19:30`,
    venue: "",
  })) as Row[],
};

/**
 * Deterministic points for every player in a fixture (both teams), by team and player name — the way
 * a scorer fills in the sheet.
 */
export function miniPoints(fixtureNo: number, bump = 0): Row[] {
  const fixture = MINI_CRICKET.fixtures[fixtureNo - 1];
  return MINI_CRICKET.players
    .filter((p) => p.team === fixture.team_a || p.team === fixture.team_b)
    .map((p, i) => ({ fixture_id: fixtureNo, team: p.team, player: p.name, points: ((i * 7 + fixtureNo * 3) % 40) - 4 + bump }));
}

export async function createCricketTournament(request: APIRequestContext, name: string, kind: "league" | "window" = "league"): Promise<{ id: string; slug: string }> {
  const res = await request.post("/api/superadmin/cricket/tournaments", { data: { name, season: "2026", kind } });
  expect(res.status(), await res.text()).toBe(201);
  const { tournament } = await res.json();
  return { id: tournament.id, slug: tournament.slug };
}

export interface UploadResponse {
  status: number;
  body: {
    committed?: boolean;
    canCommit?: boolean;
    errorCount?: number;
    warningCount?: number;
    overridableCount?: number;
    counts?: Record<string, number>;
    issues?: Array<{ row: number; message: string; level: string }>;
    validationHash?: string;
    error?: string;
    result?: { errorCount: number };
  };
}

/** Fixtures uploads can target the playoffs; everything else ignores it. */
export interface UploadOpts {
  stage?: "group" | "playoff";
}

export async function validateCricketSheet(request: APIRequestContext, tournamentId: string, kind: string, rows: Row[], opts: UploadOpts = {}): Promise<UploadResponse> {
  const res = await request.post(`/api/superadmin/cricket/tournaments/${tournamentId}/upload`, { data: { kind, mode: "validate", rows, ...opts } });
  return { status: res.status(), body: await res.json() };
}

export async function commitCricketSheet(
  request: APIRequestContext,
  tournamentId: string,
  kind: string,
  rows: Row[],
  validationHash: string | undefined,
  override = false,
  opts: UploadOpts = {},
): Promise<UploadResponse> {
  const res = await request.post(`/api/superadmin/cricket/tournaments/${tournamentId}/upload`, {
    data: { kind, mode: "commit", rows, validationHash, override, fileName: `${kind}.xlsx`, ...opts },
  });
  return { status: res.status(), body: await res.json() };
}

/** Validate then commit; fails the test unless both succeed. */
export async function uploadCricketSheet(request: APIRequestContext, tournamentId: string, kind: string, rows: Row[], opts: UploadOpts = {}): Promise<UploadResponse["body"]> {
  const v = await validateCricketSheet(request, tournamentId, kind, rows, opts);
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  expect(v.body.errorCount, JSON.stringify(v.body.issues)).toBe(0);
  const c = await commitCricketSheet(request, tournamentId, kind, rows, v.body.validationHash, false, opts);
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  expect(c.body.committed).toBe(true);
  return c.body;
}

/** A tournament with the whole mini dataset loaded (no points). */
export async function seedMiniTournament(request: APIRequestContext, name: string): Promise<{ id: string; slug: string }> {
  const t = await createCricketTournament(request, name);
  await uploadCricketSheet(request, t.id, "teams", MINI_CRICKET.teams);
  await uploadCricketSheet(request, t.id, "players", MINI_CRICKET.players);
  await uploadCricketSheet(request, t.id, "fixtures", MINI_CRICKET.fixtures);
  return t;
}

export interface CricketLeagueRef {
  id: string;
  slug: string;
  name: string;
  teamSize: number;
}

/** Squad rules small enough for the mini dataset (24 players): 4–6 players, at least 1 WK and 1 BOWL. */
export const MINI_SQUAD_RULES = {
  minSize: 4,
  maxSize: 6,
  roleMin: { WK: 1, BAT: 0, AR: 0, BOWL: 1 },
  roleMax: { WK: 2, BAT: null, AR: null, BOWL: null },
  maxPerRealTeam: null,
  maxOverseas: null,
};

/** A Classic Cricket Auction league on `tournamentId` (signed in as the superadmin). */
export async function createCricketAuctionLeague(
  request: APIRequestContext,
  opts: { tournamentId: string; teams?: number; slug?: string; settings?: Record<string, unknown> },
): Promise<CricketLeagueRef> {
  const slug = opts.slug ?? `ck-${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 4)}`;
  const res = await request.post("/api/superadmin/leagues", {
    data: {
      slug,
      name: `Cricket ${slug}`,
      sport: "cricket",
      format: "cricket-auction",
      season: "2026",
      teamSize: opts.teams ?? 4,
      cricket: {
        tournamentId: opts.tournamentId,
        purse: 1000,
        squadRules: MINI_SQUAD_RULES,
        franchiseAuctionEnabled: true,
        franchiseBoostPercent: 20,
        penaltyRedeemPrice: 25,
        bidTimerSeconds: 20,
        nominationTimeoutSeconds: 60,
        ...(opts.settings ?? {}),
      },
    },
  });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  return { id: body.id, slug: body.slug, name: body.name, teamSize: body.teamSize };
}
