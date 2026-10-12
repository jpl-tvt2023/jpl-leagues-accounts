/**
 * A person's saved FPL teams (`user_fpl_teams`). Someone may run several FPL teams; they keep them
 * all here and pick one for each league they play in (team setup copies its id into their
 * `players` row). One is their primary, which setup picks for them by default: the first one they
 * save, until they make another primary. See docs/10-accounts-and-membership.md ("Saved FPL teams").
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db, leagues, players, teamMembers, teams, userFplTeams } from "@/lib/db";
import { fetchTeamEntry } from "@/lib/sports/fpl/api";
import { generateId } from "@/lib/id";

export const MAX_FPL_TEAMS = 10;

export class FplTeamError extends Error {
  constructor(message: string, readonly status: number = 400, readonly code: string = "invalid") {
    super(message);
  }
}

/** Look up an FPL entry. `null` = no such entry; `undefined` = FPL unreachable (don't block on it). */
export async function lookUpFplEntry(id: string): Promise<{ teamName: string; managerName: string } | null | undefined> {
  try {
    const entry = await fetchTeamEntry(id, "background");
    return { teamName: entry.name, managerName: `${entry.player_first_name} ${entry.player_last_name}`.trim() };
  } catch (err) {
    return err instanceof Error && /Failed to fetch FPL team/.test(err.message) ? null : undefined;
  }
}

export interface SavedFplTeam {
  id: string;
  fplEntryId: string;
  teamName: string | null;
  managerName: string | null;
  isPrimary: boolean;
  /** Leagues this FPL team is playing in for this person. */
  playingIn: Array<{ leagueName: string; leagueSlug: string }>;
}

/** The person's saved FPL teams, oldest first, each with the leagues it is playing in for them. */
const SAVED_COLUMNS = {
  id: userFplTeams.id,
  fplEntryId: userFplTeams.fplEntryId,
  teamName: userFplTeams.teamName,
  managerName: userFplTeams.managerName,
  isPrimary: userFplTeams.isPrimary,
};

export async function listFplTeams(userId: string): Promise<SavedFplTeam[]> {
  const saved = await db
    .select(SAVED_COLUMNS)
    .from(userFplTeams)
    .where(eq(userFplTeams.userId, userId))
    .orderBy(asc(userFplTeams.createdAt), asc(userFplTeams.id));
  const playing = await db
    .select({ fplId: players.fplId, leagueName: leagues.name, leagueSlug: leagues.slug })
    .from(teamMembers)
    .innerJoin(players, eq(players.id, teamMembers.playerId))
    .innerJoin(leagues, eq(leagues.id, teamMembers.leagueId))
    .where(eq(teamMembers.userId, userId));
  return saved.map((t) => ({
    ...t,
    playingIn: playing.filter((p) => p.fplId === t.fplEntryId).map(({ leagueName, leagueSlug }) => ({ leagueName, leagueSlug })),
  }));
}

/** Whether `fplEntryId` is one of the person's saved FPL teams. */
export async function hasFplTeam(userId: string, fplEntryId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userFplTeams.id })
    .from(userFplTeams)
    .where(and(eq(userFplTeams.userId, userId), eq(userFplTeams.fplEntryId, fplEntryId)))
    .limit(1);
  return !!row;
}

/**
 * Save an FPL team to the person's list, checked against FPL: an id FPL says doesn't exist is
 * refused; if FPL can't be reached it is saved without names. Saving one already in the list
 * just returns it.
 */
export async function addFplTeam(userId: string, rawId: unknown): Promise<Omit<SavedFplTeam, "playingIn">> {
  const fplEntryId = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
  if (!/^\d{1,10}$/.test(fplEntryId)) throw new FplTeamError("FPL team IDs are numbers.");

  const findSaved = async () =>
    (
      await db
        .select(SAVED_COLUMNS)
        .from(userFplTeams)
        .where(and(eq(userFplTeams.userId, userId), eq(userFplTeams.fplEntryId, fplEntryId)))
        .limit(1)
    )[0];
  const existing = await findSaved();
  if (existing) return existing;

  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(userFplTeams).where(eq(userFplTeams.userId, userId));
  if (Number(n) >= MAX_FPL_TEAMS) throw new FplTeamError(`You can save up to ${MAX_FPL_TEAMS} FPL teams. Remove one first.`, 409, "too-many");

  const entry = await lookUpFplEntry(fplEntryId);
  if (entry === null) throw new FplTeamError("No FPL team has that ID.", 400, "not-found");
  // Your first FPL team is your primary.
  const saved = { id: generateId(), fplEntryId, teamName: entry?.teamName ?? null, managerName: entry?.managerName ?? null, isPrimary: Number(n) === 0 };
  try {
    await db.insert(userFplTeams).values({ ...saved, userId });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Two tabs adding the same id at once: the unique index settles it; return the one that won.
    const winner = await findSaved();
    if (winner) return winner;
    // Or two different first teams at once: only one can be primary, so this one isn't.
    if (!saved.isPrimary) throw err;
    saved.isPrimary = false;
    await db.insert(userFplTeams).values({ ...saved, userId });
  }
  return saved;
}

function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((err as { cause?: unknown })?.cause ?? err) + String(err));
}

/** Make one of the person's saved FPL teams their primary (the one setup picks by default). */
export async function setPrimaryFplTeam(userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: userFplTeams.id }).from(userFplTeams).where(and(eq(userFplTeams.id, id), eq(userFplTeams.userId, userId))).limit(1);
    if (!row) return false;
    // One primary per person: clear the old one first, then set the new one.
    await tx.update(userFplTeams).set({ isPrimary: false }).where(and(eq(userFplTeams.userId, userId), eq(userFplTeams.isPrimary, true)));
    await tx.update(userFplTeams).set({ isPrimary: true }).where(eq(userFplTeams.id, id));
    return true;
  });
}

/**
 * Take an FPL team off the person's list. A league already playing with it keeps its slot. If it
 * was their primary, their oldest remaining one becomes primary.
 */
export async function removeFplTeam(userId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(userFplTeams)
      .where(and(eq(userFplTeams.id, id), eq(userFplTeams.userId, userId)))
      .returning({ isPrimary: userFplTeams.isPrimary });
    if (removed.length === 0) return false;
    if (removed[0].isPrimary) {
      const [next] = await tx
        .select({ id: userFplTeams.id })
        .from(userFplTeams)
        .where(eq(userFplTeams.userId, userId))
        .orderBy(asc(userFplTeams.createdAt), asc(userFplTeams.id))
        .limit(1);
      if (next) await tx.update(userFplTeams).set({ isPrimary: true }).where(eq(userFplTeams.id, next.id));
    }
    return true;
  });
}

/** For each FPL id playing in a league, the team it plays for (to grey out taken choices). */
export async function fplIdsTakenInLeague(leagueId: string): Promise<Map<string, { teamId: string; teamName: string }>> {
  const rows = await db
    .select({ fplId: players.fplId, teamId: teams.id, teamName: teams.name })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(eq(teams.leagueId, leagueId));
  return new Map(rows.map((r) => [r.fplId, { teamId: r.teamId, teamName: r.teamName }]));
}
