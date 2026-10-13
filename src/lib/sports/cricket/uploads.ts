/**
 * Tournament uploads: validate a sheet (a dry run that writes nothing), then commit it.
 *
 * The superadmin's browser parses the spreadsheet and sends its rows; everything is checked here.
 * `validate` returns every problem, the counts of what would change, a preview and a hash. `commit`
 * runs the same validation again — the preview is never trusted — and refuses with 409 if the
 * tournament's data changed since that preview (its hash no longer matches), or with 422 if there
 * are errors. A successful commit is one atomic batch that also bumps the tournament's
 * `dataVersion`, which every league's standings cache is keyed on.
 */

import { createHash } from "node:crypto";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  cricketTournaments,
  cricketTeams,
  cricketPlayers,
  cricketFixtures,
  cricketPlayerPoints,
  cricketUploads,
  type CricketTournament,
} from "@/lib/db";
import type { CricketFixtureStage } from "@/lib/db/schema-cricket";
import { generateId } from "@/lib/id";
import { blockingIssues, warning, type RawRow, type SheetIssue, type SheetKind } from "./sheets/types";
import { parseTeamsSheet, planTeams } from "./sheets/teams";
import { assignPlayerCodes, parsePlayersSheet, planPlayers } from "./sheets/players";
import { TeamLookup } from "./sheets/names";
import { parseFixturesSheet, planFixtures } from "./sheets/fixtures";
import { parsePointsSheet } from "./sheets/points";
import { formatIst } from "./sheets/ist";
import { fixturesWithPoints, loadTournamentUsage, playersWithPoints } from "./tournaments";

export const MAX_UPLOAD_ROWS = 5000;
/** Rows per INSERT statement. */
const CHUNK = 200;
/** Issues returned to the page; the counts always cover all of them. */
const MAX_ISSUES = 500;
const PREVIEW_ROWS = 50;

export interface UploadInput {
  kind: SheetKind;
  mode: "validate" | "commit";
  rows: RawRow[];
  fileName?: string | null;
  validationHash?: string | null;
  /** Push through overridable errors (changes after an auction started). Recorded in the audit row. */
  override?: boolean;
  /** Fixtures only: which stage the sheet replaces (default "group"). Playoffs need a league tournament. */
  stage?: CricketFixtureStage;
}

export interface UploadCounts {
  rows: number;
  inserts: number;
  updates: number;
  deletes: number;
  unchanged: number;
  /** Points only: fixtures whose points are replaced, and the points rows they had before. */
  fixtures?: number;
  replacedRows?: number;
}

export interface UploadResult {
  kind: SheetKind;
  committed: boolean;
  counts: UploadCounts;
  issues: SheetIssue[];
  errorCount: number;
  warningCount: number;
  /** Errors that only the superadmin override would let through. */
  overridableCount: number;
  canCommit: boolean;
  preview: Array<Record<string, string | number | boolean | null>>;
  validationHash: string;
  dataVersion: number;
}

export class UploadError extends Error {
  constructor(message: string, readonly status: number, readonly result?: UploadResult) {
    super(message);
  }
}

/** A planned upload: what it reports, and (when valid) the statements that apply it. */
interface Planned {
  counts: UploadCounts;
  issues: SheetIssue[];
  preview: UploadResult["preview"];
  /** Canonical form of the normalised rows, hashed into validationHash. */
  canonical: unknown;
  apply: (uploadId: string, now: Date) => BatchItem<"sqlite">[];
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function planUpload(t: CricketTournament, kind: SheetKind, rows: RawRow[], stage: CricketFixtureStage): Promise<Planned> {
  const teams = await db.select().from(cricketTeams).where(eq(cricketTeams.tournamentId, t.id));
  const teamIdByCode = new Map(teams.map((x) => [x.code, x.id]));
  const teamCodeById = new Map(teams.map((x) => [x.id, x.code]));
  // Sheets name teams by code or full name.
  const teamLookup = new TeamLookup(teams);

  if (kind === "teams") {
    const parsed = parseTeamsSheet(rows);
    const [usage, players, fixtures] = await Promise.all([
      loadTournamentUsage(t.id),
      db.select({ teamId: cricketPlayers.teamId }).from(cricketPlayers).where(eq(cricketPlayers.tournamentId, t.id)),
      db.select({ a: cricketFixtures.teamAId, b: cricketFixtures.teamBId }).from(cricketFixtures).where(eq(cricketFixtures.tournamentId, t.id)),
    ]);
    const referenced = new Set<number>([...players.map((p) => p.teamId), ...fixtures.flatMap((f) => [f.a, f.b]), ...usage.ownedFranchiseTeamIds]);
    const plan = planTeams(teams, parsed.rows, { referencedTeamIds: referenced, franchiseAuctionStarted: usage.franchiseAuctionStarted });
    return {
      counts: { rows: rows.length, inserts: plan.inserts.length, updates: plan.updates.length, deletes: plan.deletes.length, unchanged: plan.unchanged },
      issues: [...parsed.issues, ...plan.issues],
      preview: parsed.rows.slice(0, PREVIEW_ROWS).map((r) => ({ row: r.row, team_code: r.code, name: r.name, base_price: r.basePrice })),
      canonical: parsed.rows.map((r) => [r.code, r.name, r.basePrice]),
      apply: (_uploadId, now) => [
        ...chunks(plan.inserts).map((c) =>
          db.insert(cricketTeams).values(c.map((r) => ({ tournamentId: t.id, code: r.code, name: r.name, basePrice: r.basePrice }))),
        ),
        ...plan.updates.map((u) => db.update(cricketTeams).set({ name: u.row.name, basePrice: u.row.basePrice, updatedAt: now }).where(eq(cricketTeams.id, u.id))),
        ...(plan.deletes.length ? [db.delete(cricketTeams).where(inArray(cricketTeams.id, plan.deletes))] : []),
      ],
    };
  }

  if (kind === "players") {
    const parsed = parsePlayersSheet(rows, { teams: teamLookup });
    const [existing, usage, scored] = await Promise.all([
      db.select().from(cricketPlayers).where(eq(cricketPlayers.tournamentId, t.id)),
      loadTournamentUsage(t.id),
      playersWithPoints(t.id),
    ]);
    // Blank player_ids: an already-uploaded player with the same name keeps theirs; new ones get a slug.
    parsed.rows = assignPlayerCodes(
      parsed.rows,
      existing.map((p) => ({ code: p.code, name: p.name, teamCode: teamCodeById.get(p.teamId) ?? "" })),
    );
    const plan = planPlayers(existing, parsed.rows, {
      teamIdByCode,
      playersWithPoints: scored,
      ownedPlayerIds: usage.ownedPlayerIds,
      auctionStarted: usage.auctionStarted,
    });
    const values = (r: (typeof plan.inserts)[number]) => ({
      name: r.name,
      teamId: r.teamId,
      role: r.role,
      basePrice: r.basePrice,
      overseas: r.overseas,
      matchesTest: r.matchesTest,
      matchesOdi: r.matchesOdi,
      matchesT20: r.matchesT20,
    });
    return {
      counts: { rows: rows.length, inserts: plan.inserts.length, updates: plan.updates.length, deletes: plan.deletes.length, unchanged: plan.unchanged },
      issues: [...parsed.issues, ...plan.issues],
      preview: parsed.rows.slice(0, PREVIEW_ROWS).map((r) => ({
        row: r.row,
        player_id: r.code,
        name: r.name,
        team: r.teamCode,
        role: r.role,
        base_price: r.basePrice,
        overseas: r.overseas ? "Y" : "N",
        Test: r.matchesTest,
        ODI: r.matchesOdi,
        T20: r.matchesT20,
      })),
      canonical: parsed.rows.map((r) => [r.code, r.name, r.teamCode, r.role, r.basePrice, r.overseas, r.matchesTest, r.matchesOdi, r.matchesT20]),
      apply: (_uploadId, now) => [
        ...chunks(plan.inserts).map((c) => db.insert(cricketPlayers).values(c.map((r) => ({ tournamentId: t.id, code: r.code, ...values(r) })))),
        ...plan.updates.map((u) => db.update(cricketPlayers).set({ ...values(u.row), updatedAt: now }).where(eq(cricketPlayers.id, u.id))),
        ...(plan.deletes.length ? [db.delete(cricketPlayers).where(inArray(cricketPlayers.id, plan.deletes))] : []),
      ],
    };
  }

  if (kind === "fixtures") {
    const parsed = parseFixturesSheet(rows, { teams: teamLookup, stage });
    const [existing, scored] = await Promise.all([
      db.select().from(cricketFixtures).where(eq(cricketFixtures.tournamentId, t.id)),
      fixturesWithPoints(t.id),
    ]);
    const plan = planFixtures(
      existing.map((f) => ({ ...f, hasPoints: scored.has(f.id) || f.pointsUploadedAt !== null })),
      parsed.rows,
      { teamIdByCode, stage },
    );
    const stageIssues = stage === "playoff" && t.kind !== "league" ? [{ row: 0, message: "Only a league tournament (like the IPL) has playoffs", level: "error" as const }] : [];
    const values = (r: (typeof plan.inserts)[number]) => ({
      series: r.series,
      fixtureNo: r.fixtureNo,
      stage,
      matchFormat: r.matchFormat,
      teamAId: r.teamAId,
      teamBId: r.teamBId,
      startsAt: r.startsAt,
      venue: r.venue,
    });
    return {
      counts: { rows: rows.length, inserts: plan.inserts.length, updates: plan.updates.length, deletes: plan.deletes.length, unchanged: plan.unchanged },
      issues: [...stageIssues, ...parsed.issues, ...plan.issues],
      preview: plan.rows.slice(0, PREVIEW_ROWS).map((r) => ({
        row: r.row,
        series: r.series,
        fixture_id: r.fixtureNo,
        stage: stage === "playoff" ? "Playoffs" : "Group",
        format: r.matchFormat,
        team_a: r.teamACode,
        team_b: r.teamBCode,
        start_ist: formatIst(r.startsAt),
        start_utc: r.startsAt.toISOString(),
        venue: r.venue,
      })),
      canonical: [stage, plan.rows.map((r) => [r.series, r.fixtureNo, r.matchFormat, r.teamACode, r.teamBCode, r.startsAt.toISOString(), r.venue])],
      apply: (_uploadId, now) => [
        ...chunks(plan.inserts).map((c) => db.insert(cricketFixtures).values(c.map((r) => ({ tournamentId: t.id, ...values(r) })))),
        ...plan.updates.map((u) => db.update(cricketFixtures).set({ ...values(u.row), updatedAt: now }).where(eq(cricketFixtures.id, u.id))),
        ...(plan.deletes.length ? [db.delete(cricketFixtures).where(inArray(cricketFixtures.id, plan.deletes))] : []),
      ],
    };
  }

  // points
  const [fixtures, players, usage] = await Promise.all([
    db
      .select({
        id: cricketFixtures.id,
        series: cricketFixtures.series,
        fixtureNo: cricketFixtures.fixtureNo,
        teamAId: cricketFixtures.teamAId,
        teamBId: cricketFixtures.teamBId,
        startsAt: cricketFixtures.startsAt,
        status: cricketFixtures.status,
      })
      .from(cricketFixtures)
      .where(eq(cricketFixtures.tournamentId, t.id)),
    db
      .select({ id: cricketPlayers.id, code: cricketPlayers.code, name: cricketPlayers.name, teamId: cricketPlayers.teamId })
      .from(cricketPlayers)
      .where(eq(cricketPlayers.tournamentId, t.id)),
    loadTournamentUsage(t.id),
  ]);
  const parsed = parsePointsSheet(rows, { fixtures, players, teams: teamLookup, teamIdByCode, now: new Date() });
  const issues = [...parsed.issues];
  if (fixtures.length === 0) issues.push({ row: 0, message: "Upload the Fixtures sheet first", level: "error" });
  if (usage.completedLeagueNames.length && parsed.rows.length) {
    issues.push(warning(0, `Already marked complete, and will be recalculated: ${usage.completedLeagueNames.join(", ")}`));
  }
  let replacedRows = 0;
  if (parsed.fixtureIds.length) {
    const [r] = await db
      .select({ n: sql<number>`count(*)` })
      .from(cricketPlayerPoints)
      .where(inArray(cricketPlayerPoints.fixtureId, parsed.fixtureIds));
    replacedRows = Number(r.n);
  }
  const fixtureById = new Map(fixtures.map((f) => [f.id, f]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  return {
    counts: {
      rows: rows.length,
      inserts: parsed.rows.length,
      updates: 0,
      deletes: replacedRows,
      unchanged: 0,
      fixtures: parsed.fixtureIds.length,
      replacedRows,
    },
    issues,
    preview: parsed.rows.slice(0, PREVIEW_ROWS).map((r) => {
      const f = fixtureById.get(r.fixtureId)!;
      const p = playerById.get(r.playerId)!;
      return { row: r.row, series: f.series, fixture_id: f.fixtureNo, player_id: p.code, name: p.name, team: teamCodeById.get(p.teamId) ?? "", points: r.points };
    }),
    canonical: parsed.rows.map((r) => [r.fixtureId, r.playerId, r.points]),
    apply: (uploadId, now) => [
      ...(parsed.fixtureIds.length ? [db.delete(cricketPlayerPoints).where(inArray(cricketPlayerPoints.fixtureId, parsed.fixtureIds))] : []),
      ...chunks(parsed.rows).map((c) =>
        db.insert(cricketPlayerPoints).values(c.map((r) => ({ fixtureId: r.fixtureId, playerId: r.playerId, tournamentId: t.id, points: r.points, uploadId }))),
      ),
      ...(parsed.fixtureIds.length
        ? [
            db
              .update(cricketFixtures)
              .set({ status: "completed", pointsUploadedAt: now, updatedAt: now })
              .where(and(eq(cricketFixtures.tournamentId, t.id), inArray(cricketFixtures.id, parsed.fixtureIds))),
          ]
        : []),
    ],
  };
}

function hashOf(kind: SheetKind, dataVersion: number, canonical: unknown): string {
  return createHash("sha256").update(JSON.stringify({ kind, dataVersion, canonical })).digest("hex").slice(0, 32);
}

/** Validate (and, with mode "commit", apply) one sheet upload for a tournament. */
export async function runUpload(tournamentId: string, input: UploadInput, userId: string | null): Promise<UploadResult> {
  const [t] = await db.select().from(cricketTournaments).where(eq(cricketTournaments.id, tournamentId)).limit(1);
  if (!t) throw new UploadError("Tournament not found", 404);
  if (!Array.isArray(input.rows)) throw new UploadError("rows must be an array", 400);
  if (input.rows.length > MAX_UPLOAD_ROWS) throw new UploadError(`At most ${MAX_UPLOAD_ROWS} rows per upload`, 400);

  const stage: CricketFixtureStage = input.kind === "fixtures" && input.stage === "playoff" ? "playoff" : "group";
  const planned = await planUpload(t, input.kind, input.rows, stage);
  const override = !!input.override;
  const errorCount = planned.issues.filter((i) => i.level === "error").length;
  const overridableCount = planned.issues.filter((i) => i.level === "error" && i.overridable).length;
  const blocking = blockingIssues(planned.issues, override);
  const result: UploadResult = {
    kind: input.kind,
    committed: false,
    counts: planned.counts,
    issues: planned.issues.slice(0, MAX_ISSUES),
    errorCount,
    warningCount: planned.issues.length - errorCount,
    overridableCount,
    canCommit: blocking.length === 0,
    preview: planned.preview,
    validationHash: hashOf(input.kind, t.dataVersion, planned.canonical),
    dataVersion: t.dataVersion,
  };
  if (input.mode !== "commit") return result;

  if (!input.validationHash || input.validationHash !== result.validationHash) {
    throw new UploadError("The data changed since this preview (or the file did). Validate again before committing.", 409, result);
  }
  if (blocking.length) throw new UploadError("Fix the errors before committing", 422, result);

  const uploadId = generateId();
  const now = new Date();
  const statements = planned.apply(uploadId, now);
  // One atomic batch: the data, the version bump and the audit row land together or not at all.
  // The audit row goes first; points rows carry its id.
  await db.batch([
    db.insert(cricketUploads).values({
      id: uploadId,
      tournamentId: t.id,
      kind: input.kind,
      fileName: input.fileName ?? null,
      rowCount: input.rows.length,
      summary: JSON.stringify({
        ...planned.counts,
        warnings: result.warningCount,
        override: override && overridableCount > 0 ? overridableCount : 0,
        ...(input.kind === "fixtures" ? { stage } : {}),
      }),
      uploadedBy: userId,
      createdAt: now,
    }),
    ...statements,
    db
      .update(cricketTournaments)
      .set({ dataVersion: sql`${cricketTournaments.dataVersion} + 1`, updatedAt: now })
      .where(eq(cricketTournaments.id, t.id)),
  ]);
  return { ...result, committed: true, dataVersion: t.dataVersion + 1 };
}
