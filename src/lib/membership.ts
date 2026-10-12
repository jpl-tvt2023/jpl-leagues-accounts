/**
 * Members-mode leagues: invites, joining, teammates, approvals and the admin's membership tools.
 * See docs/10-accounts-and-membership.md ("Members-mode leagues").
 *
 * Every change that touches more than one row runs in a transaction. The database's unique
 * indexes are the final word on races — one team per person per league, one owner per team —
 * so two people tapping the same invite at the same moment can't both get the same slot.
 */

import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import {
  auditLogs,
  db,
  fixtures,
  gameweeks,
  joinRequests,
  leagueAdmins,
  leagueInvites,
  leagues,
  players,
  teamMembers,
  teams,
  users,
  type LeagueInvite,
} from "@/lib/db";
import { generateId } from "@/lib/id";
import { formatCaps } from "@/lib/formats/registry";

/** Most people per team, by format (from the format registry). TVT and Continental teams are two FPL managers. */
export function maxMembersFor(format: string): number {
  return formatCaps(format).maxTeamMembers;
}

export const LEAGUE_INVITE_DAYS = 14;
export const PARTNER_INVITE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 128 random bits, URL-safe. The token is the invite's whole secret. */
export function newInviteToken(): string {
  return randomBytes(16).toString("base64url");
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

function isBusy(err: unknown): boolean {
  const text = `${String(err)} ${String((err as { cause?: unknown })?.cause ?? "")}`;
  return /SQLITE_BUSY|database is locked/i.test(text);
}

/**
 * One membership write at a time within this process.
 *
 * Two people tapping the same invite at the same moment would otherwise race two transactions.
 * On a local SQLite file (tests, dev) the loser gets SQLITE_BUSY — and the libsql local client
 * then leaves that connection in a state where the next transaction that writes and rolls back
 * keeps the database locked for everyone (reproduced: BUSY, then write + rollback, then every
 * query is BUSY). Queuing membership writes means they never collide in-process; the unique
 * indexes still settle races across processes.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
}

/**
 * A membership write transaction: queued (see above), and briefly retried if another process
 * holds the write lock — hosted Turso can answer SQLITE_BUSY under contention, and a retry there
 * is safe. (drizzle's libsql driver always opens write transactions with BEGIN IMMEDIATE.)
 * Must not be nested: a writeTx inside another would wait on itself.
 */
function writeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return serialized(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.transaction(fn);
      } catch (err) {
        if (!isBusy(err) || attempt >= 7) throw err;
        await new Promise((resolve) => setTimeout(resolve, 15 + Math.random() * 40 * (attempt + 1)));
      }
    }
  });
}

export class MembershipError extends Error {
  constructor(message: string, readonly status: number = 400, readonly code: string = "invalid") {
    super(message);
  }
}

/**
 * Superadmins run the platform and never play: no team and no join request, in any league.
 * (League admins can also play.) Every path onto a team goes through this.
 */
async function assertNotSuperadmin(dbx: Db, userId: string, message: string): Promise<void> {
  const [row] = await dbx.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (row?.role === "superadmin") throw new MembershipError(message, 403, "superadmin");
}

export const SUPERADMIN_CANNOT_JOIN = "Superadmins run leagues but can't join one as a player.";
const SUPERADMIN_CANNOT_BE_ASSIGNED = "That person is a superadmin. Superadmins can't be on a team.";

async function audit(dbx: Db, type: string, description: string, ids: { userId?: string | null; leagueId?: string | null; teamId?: string | null }) {
  await dbx.insert(auditLogs).values({
    id: generateId(),
    type,
    description,
    userId: ids.userId ?? null,
    leagueId: ids.leagueId ?? null,
    teamId: ids.teamId ?? null,
  });
}

// ─── Switching an old league to Google sign-in ───────────────────────────────

/**
 * Move a league from before accounts (`auth_mode = "legacy"`, whose team logins no longer work)
 * to Google sign-in. Teams, players, fixtures and history stay exactly as they are; only how
 * people reach a team changes. The old team passwords are wiped, so nothing could sign in with
 * them even in principle.
 *
 * Afterwards every team is open (no members). People sign in with Google and the league admin
 * puts each one on their own team from the Members tab (assign by username). No league invite is
 * created here: one would hand the next person whichever open team comes first, not their own.
 */
export async function switchLeagueToGoogleSignIn(leagueId: string, byUserId: string | null): Promise<void> {
  await writeTx(async (tx) => {
    const [league] = await tx
      .select({ authMode: leagues.authMode, format: leagues.format, name: leagues.name })
      .from(leagues)
      .where(eq(leagues.id, leagueId))
      .limit(1);
    if (!league) throw new MembershipError("League not found.", 404, "not-found");
    if (league.format === "fpl-classic") throw new MembershipError("FPL Classic leagues have no accounts.", 400, "fpl-classic");
    if (league.authMode === "members") throw new MembershipError("This league already uses Google sign-in.", 409, "already-members");
    await tx.update(leagues).set({ authMode: "members" }).where(eq(leagues.id, leagueId));
    await tx.update(teams).set({ password: "", mustChangePassword: false }).where(eq(teams.leagueId, leagueId));
    await audit(tx, "LEAGUE_SWITCHED_TO_GOOGLE", `${league.name} switched from team logins to Google sign-in`, { userId: byUserId, leagueId });
  });
}

// ─── Invites ──────────────────────────────────────────────────────────────────

export interface InviteOptions {
  requiresApproval?: boolean;
  /** null = unlimited. Defaults to the league's team count. */
  maxUses?: number | null;
  /** null = never expires. Defaults to 14 days. */
  expiresInDays?: number | null;
}

/**
 * Create the league's invite link, revoking any earlier active one — a league has one live link,
 * so "regenerate" is simply creating a new one.
 */
export async function createLeagueInvite(leagueId: string, createdByUserId: string | null, opts: InviteOptions = {}): Promise<LeagueInvite> {
  const [league] = await db.select({ teamSize: leagues.teamSize }).from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  if (!league) throw new MembershipError("League not found", 404);
  const now = new Date();
  const expiresInDays = opts.expiresInDays === undefined ? LEAGUE_INVITE_DAYS : opts.expiresInDays;
  const invite = {
    id: generateId(),
    leagueId,
    teamId: null,
    token: newInviteToken(),
    createdByUserId,
    maxUses: opts.maxUses === undefined ? league.teamSize : opts.maxUses,
    useCount: 0,
    requiresApproval: opts.requiresApproval ?? false,
    expiresAt: expiresInDays === null ? null : new Date(now.getTime() + expiresInDays * DAY_MS),
    revokedAt: null,
    createdAt: now,
  };
  await writeTx(async (tx) => {
    await tx
      .update(leagueInvites)
      .set({ revokedAt: now })
      .where(and(eq(leagueInvites.leagueId, leagueId), isNull(leagueInvites.teamId), isNull(leagueInvites.revokedAt)));
    await tx.insert(leagueInvites).values(invite);
  });
  return invite;
}

/** A single-use, seven-day link for a team owner to bring in their teammate. Replaces any earlier one. */
export async function createPartnerInvite(teamId: string, createdByUserId: string): Promise<LeagueInvite> {
  const [team] = await db.select({ leagueId: teams.leagueId }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new MembershipError("Team not found", 404);
  const now = new Date();
  const invite = {
    id: generateId(),
    leagueId: team.leagueId,
    teamId,
    token: newInviteToken(),
    createdByUserId,
    maxUses: 1,
    useCount: 0,
    requiresApproval: false,
    expiresAt: new Date(now.getTime() + PARTNER_INVITE_DAYS * DAY_MS),
    revokedAt: null,
    createdAt: now,
  };
  await writeTx(async (tx) => {
    await tx.update(leagueInvites).set({ revokedAt: now }).where(and(eq(leagueInvites.teamId, teamId), isNull(leagueInvites.revokedAt)));
    await tx.insert(leagueInvites).values(invite);
  });
  return invite;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await db.update(leagueInvites).set({ revokedAt: new Date() }).where(eq(leagueInvites.id, inviteId));
}

export type InviteProblem = "not-found" | "revoked" | "expired" | "used-up" | "legacy-league" | "inactive-league" | "team-full";

/** What the join page and API say when an invite can't be used. */
export const INVITE_PROBLEM_MESSAGES: Record<InviteProblem, string> = {
  "not-found": "This invite link doesn't exist. Check you copied all of it.",
  revoked: "This invite link has been turned off. Ask your league admin for a new one.",
  expired: "This invite link has expired. Ask your league admin for a new one.",
  "used-up": "This invite link has been used up. Ask your league admin for a new one.",
  "legacy-league": "This league uses team IDs from the admin, not invite links.",
  "inactive-league": "This league isn't active right now.",
  "team-full": "This team already has its full line-up.",
};

export interface LoadedInvite {
  invite: LeagueInvite;
  league: { id: string; slug: string; name: string; format: string; season: string; teamSize: number; authMode: string; isActive: boolean };
  team: { id: string; name: string } | null;
  /** Open (unclaimed) slots in the league, for league invites. */
  openSlots: number;
  problem: InviteProblem | null;
}

/** An invite by its token, with everything the join page shows and why it can't be used, if so. */
export async function loadInvite(token: string): Promise<LoadedInvite | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [invite] = await db.select().from(leagueInvites).where(eq(leagueInvites.token, token)).limit(1);
  if (!invite) return null;
  const [league] = await db
    .select({ id: leagues.id, slug: leagues.slug, name: leagues.name, format: leagues.format, season: leagues.season, teamSize: leagues.teamSize, authMode: leagues.authMode, isActive: leagues.isActive })
    .from(leagues)
    .where(eq(leagues.id, invite.leagueId))
    .limit(1);
  if (!league) return null;
  const team = invite.teamId
    ? (await db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, invite.teamId)).limit(1))[0] ?? null
    : null;
  const openSlots = invite.teamId ? 0 : await countOpenSlots(league.id);

  let problem: InviteProblem | null = null;
  if (league.authMode !== "members") problem = "legacy-league";
  else if (!league.isActive) problem = "inactive-league";
  else if (invite.revokedAt) problem = "revoked";
  else if (invite.expiresAt && invite.expiresAt < new Date()) problem = "expired";
  else if (invite.maxUses !== null && invite.useCount >= invite.maxUses) problem = "used-up";
  else if (invite.teamId && team) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(teamMembers).where(eq(teamMembers.teamId, team.id));
    if (Number(n) >= maxMembersFor(league.format)) problem = "team-full";
  }
  return { invite, league, team, openSlots, problem };
}

/** Teams in the league nobody has claimed yet (ghost teams never count). */
function openSlotCondition(leagueId: string) {
  return and(
    eq(teams.leagueId, leagueId),
    eq(teams.isGhost, false),
    notExists(db.select({ one: sql`1` }).from(teamMembers).where(eq(teamMembers.teamId, teams.id))),
  );
}

export async function countOpenSlots(leagueId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(teams).where(openSlotCondition(leagueId));
  return Number(n);
}

/** Count a use against the invite, unless it just ran out. False = no uses left. */
async function spendInvite(dbx: Db, inviteId: string): Promise<boolean> {
  const spent = await dbx
    .update(leagueInvites)
    .set({ useCount: sql`${leagueInvites.useCount} + 1` })
    .where(and(eq(leagueInvites.id, inviteId), or(isNull(leagueInvites.maxUses), sql`${leagueInvites.useCount} < ${leagueInvites.maxUses}`)))
    .returning({ id: leagueInvites.id });
  return spent.length > 0;
}

function isUniqueViolation(err: unknown): boolean {
  const text = String((err as { cause?: unknown })?.cause ?? err) + String(err);
  return /UNIQUE constraint failed/i.test(text);
}

// ─── Joining ─────────────────────────────────────────────────────────────────

export async function teamOfUserInLeague(userId: string, leagueId: string): Promise<{ teamId: string; role: "owner" | "member" } | null> {
  const [row] = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.leagueId, leagueId)))
    .limit(1);
  return row ?? null;
}

/**
 * Give `userId` the first open team in the league, as its owner. Retries on the next slot if
 * someone else claims the same one at the same instant.
 */
export async function claimOpenSlot(leagueId: string, userId: string, viaInviteId: string | null): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await writeTx(async (tx) => {
        await assertNotSuperadmin(tx, userId, SUPERADMIN_CANNOT_JOIN);
        if (await alreadyInLeague(tx, userId, leagueId)) throw new MembershipError("You're already in this league.", 409, "already-member");
        const [slot] = await tx
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(openSlotCondition(leagueId))
          .orderBy(asc(teams.createdAt), asc(teams.id))
          .limit(1);
        if (!slot) throw new MembershipError("This league is full.", 409, "league-full");
        if (viaInviteId && !(await spendInvite(tx, viaInviteId))) {
          throw new MembershipError("This invite link has been used up. Ask your league admin for a new one.", 410, "used-up");
        }
        await tx.insert(teamMembers).values({ id: generateId(), teamId: slot.id, leagueId, userId, role: "owner" });
        await audit(tx, "MEMBER_JOINED", `Joined and claimed ${slot.name}`, { userId, leagueId, teamId: slot.id });
        return slot.id;
      });
    } catch (err) {
      if (err instanceof MembershipError) throw err;
      if (isUniqueViolation(err) && attempt < 4) continue; // lost the race for that slot — take the next
      throw err;
    }
  }
  throw new MembershipError("Couldn't claim a team — please try again.", 409, "busy");
}

async function alreadyInLeague(dbx: Db, userId: string, leagueId: string): Promise<boolean> {
  const [row] = await dbx.select({ id: teamMembers.id }).from(teamMembers).where(and(eq(teamMembers.userId, userId), eq(teamMembers.leagueId, leagueId))).limit(1);
  return !!row;
}

/**
 * Join a specific team as its owner's teammate, through a partner invite. They aren't linked to an
 * FPL slot yet: team setup asks for their own details (or which slot is theirs) next.
 */
export async function joinAsPartner(invite: LeagueInvite, userId: string): Promise<string> {
  if (!invite.teamId) throw new MembershipError("Not a teammate invite.");
  const teamId = invite.teamId;
  try {
    return await writeTx(async (tx) => {
      await assertNotSuperadmin(tx, userId, SUPERADMIN_CANNOT_JOIN);
      if (await alreadyInLeague(tx, userId, invite.leagueId)) throw new MembershipError("You're already in this league.", 409, "already-member");
      const [league] = await tx.select({ format: leagues.format }).from(leagues).where(eq(leagues.id, invite.leagueId)).limit(1);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
      if (Number(n) >= maxMembersFor(league?.format ?? "")) throw new MembershipError("This team already has its full line-up.", 409, "team-full");
      if (!(await spendInvite(tx, invite.id))) throw new MembershipError("This invite has already been used.", 410, "used-up");
      const role = Number(n) === 0 ? "owner" : "member";
      await tx.insert(teamMembers).values({ id: generateId(), teamId, leagueId: invite.leagueId, userId, role });
      await audit(tx, "MEMBER_JOINED", "Joined as teammate via invite", { userId, leagueId: invite.leagueId, teamId });
      return teamId;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new MembershipError("You're already in this league.", 409, "already-member");
    throw err;
  }
}

// ─── FPL slots (team setup) ──────────────────────────────────────────────────

/** Formats where each person on a team is one of its FPL managers (one `players` row each). */
export function hasPlayerSlots(format: string): boolean {
  return maxMembersFor(format) >= 2;
}

/**
 * Whether a person still has team setup to do. In TVT and Continental everyone enters their own
 * FPL details, so that's until they're linked to one of the team's FPL slots; in auction leagues
 * it's until the team is named.
 */
export function needsSetup(t: { format: string; isProfileComplete: boolean; playerId: string | null }): boolean {
  return hasPlayerSlots(t.format) ? !t.playerId : !t.isProfileComplete;
}

/** Where a person's link to their team goes: setup while they have some to do, else the dashboard. */
export async function teamLanding(userId: string, leagueId: string, slug: string): Promise<string> {
  const [row] = await db
    .select({ format: leagues.format, isProfileComplete: teams.isProfileComplete, playerId: teamMembers.playerId })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(leagues, eq(leagues.id, teamMembers.leagueId))
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.leagueId, leagueId)))
    .limit(1);
  if (!row) return `/${slug}`;
  return needsSetup(row) ? `/${slug}/setup` : `/${slug}/dashboard`;
}

export interface PlayerSlot {
  id: string;
  name: string;
  fplId: string;
  /** The person linked to this slot, if anyone is. */
  userId: string | null;
  role: "owner" | "member" | null;
}

/** A team's FPL slots in a stable order, each with the person linked to it (if any). */
export async function teamSlots(teamId: string, dbx: Db = db): Promise<PlayerSlot[]> {
  const rows = await dbx
    .select({ id: players.id, name: players.name, fplId: players.fplId })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(asc(players.createdAt), asc(players.id));
  const links = await dbx
    .select({ playerId: teamMembers.playerId, userId: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  return rows.map((p) => {
    const link = links.find((l) => l.playerId === p.id);
    return { ...p, userId: link?.userId ?? null, role: link?.role ?? null };
  });
}

async function teamLeague(dbx: Db, teamId: string): Promise<{ leagueId: string; format: string }> {
  const [row] = await dbx.select({ leagueId: teams.leagueId, format: leagues.format }).from(teams).innerJoin(leagues, eq(leagues.id, teams.leagueId)).where(eq(teams.id, teamId)).limit(1);
  if (!row) throw new MembershipError("Team not found", 404);
  return row;
}

/**
 * A two-manager team is set up once every FPL slot is filled: each partner entered their own
 * details, or the owner entered a partner who won't sign in. Call after writing a team's player
 * rows. Auction teams are left alone; setup marks those itself once they're named.
 */
export async function refreshTeamComplete(teamId: string, dbx: Db = db): Promise<boolean> {
  const [team] = await dbx
    .select({ format: leagues.format, done: teams.isProfileComplete })
    .from(teams)
    .innerJoin(leagues, eq(leagues.id, teams.leagueId))
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) return false;
  if (!hasPlayerSlots(team.format)) return team.done;
  const [{ n }] = await dbx.select({ n: sql<number>`count(*)` }).from(players).where(eq(players.teamId, teamId));
  const done = Number(n) >= maxMembersFor(team.format);
  if (done !== team.done) await dbx.update(teams).set({ isProfileComplete: done, updatedAt: new Date() }).where(eq(teams.id, teamId));
  return done;
}

export interface PlayerDetails {
  name: string;
  fplId: string;
}

/** A name and FPL ID from a form, cleaned up, or what's wrong with them. `who` starts the error ("Your", "Your partner's"). */
export function readPlayerDetails(input: { name?: unknown; fplId?: unknown }, who = "Your"): PlayerDetails | { error: string } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const fplId = typeof input.fplId === "string" || typeof input.fplId === "number" ? String(input.fplId).trim() : "";
  if (!name) return { error: `${who} name is required` };
  if (name.length > 60) return { error: `${who} name is too long (60 characters at most)` };
  if (!fplId) return { error: `${who} FPL ID is required` };
  if (!/^\d{1,10}$/.test(fplId)) return { error: `${who} FPL ID must be a number` };
  return { name, fplId };
}

/**
 * One FPL team plays for at most one team per league (it can play in any number of leagues).
 * `exceptSlotId` is the slot being written, which may already hold that id.
 */
async function assertFplIdFree(dbx: Db, leagueId: string, slots: PlayerSlot[], fplId: string, exceptSlotId: string | null): Promise<void> {
  if (slots.some((s) => s.id !== exceptSlotId && s.fplId === fplId)) {
    throw new MembershipError("That FPL ID is already on your team.", 409, "duplicate-fpl-id");
  }
  const [elsewhere] = await dbx
    .select({ teamName: teams.name })
    .from(players)
    .innerJoin(teams, eq(teams.id, players.teamId))
    .where(and(eq(teams.leagueId, leagueId), eq(players.fplId, fplId), exceptSlotId ? ne(players.id, exceptSlotId) : undefined))
    .limit(1);
  if (elsewhere) {
    throw new MembershipError(`That FPL team already plays for ${elsewhere.teamName} in this league.`, 409, "duplicate-fpl-id");
  }
}

/**
 * When a league's FPL teams were fixed: the deadline of its first gameweek with a fixture, once
 * that has passed. Null until then, and for a league with no fixtures yet. After this, people
 * can't switch which FPL team plays for them (only league admins can, from the team editor),
 * though an empty slot can still be filled by someone joining late.
 *
 * Fixtures, not gameweek rows, mark the start: TVT seeds rows from GW1 even for a league created
 * mid-season, and some admin tools insert rows with made-up deadlines.
 */
export async function leagueFplLock(leagueId: string, dbx: Db = db): Promise<{ gw: number; deadline: Date } | null> {
  const [first] = await dbx
    .select({ gw: gameweeks.number, deadline: gameweeks.deadline })
    .from(fixtures)
    .innerJoin(gameweeks, eq(gameweeks.id, fixtures.gameweekId))
    .where(eq(gameweeks.leagueId, leagueId))
    .orderBy(asc(gameweeks.number))
    .limit(1);
  return first && first.deadline <= new Date() ? first : null;
}

/** Refuse to change an FPL id a slot already plays with, once the league's FPL teams are fixed. */
async function assertFplChangeAllowed(dbx: Db, leagueId: string, current: string | null | undefined, next: string): Promise<void> {
  if (!current || current === next) return;
  const lock = await leagueFplLock(leagueId, dbx);
  if (lock) {
    throw new MembershipError(`FPL teams were fixed at the GW${lock.gw} deadline. Ask your league admin to change it.`, 409, "fpl-locked");
  }
}

/**
 * Save a person's own FPL details on their team and link them to that slot: the slot they're
 * already linked to; else the unlinked slot they picked (one the owner filled in for them, or a
 * past teammate's); else a new slot if the team has room. Never writes anyone else's slot.
 */
export async function saveOwnPlayer(
  teamId: string,
  userId: string,
  details: PlayerDetails,
  pickedSlotId: string | null = null,
): Promise<{ playerId: string; teamComplete: boolean }> {
  return writeTx(async (tx) => {
    const [me] = await tx
      .select({ id: teamMembers.id, playerId: teamMembers.playerId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .limit(1);
    if (!me) throw new MembershipError("You're not on this team.", 403, "not-member");
    const { leagueId, format } = await teamLeague(tx, teamId);
    if (!hasPlayerSlots(format)) throw new MembershipError("Teams in this format don't have FPL slots.");
    const slots = await teamSlots(teamId, tx);

    let target = me.playerId ? (slots.find((s) => s.id === me.playerId) ?? null) : null;
    if (!target && pickedSlotId) {
      target = slots.find((s) => s.id === pickedSlotId) ?? null;
      if (!target) throw new MembershipError("That FPL slot isn't on your team.", 400, "bad-slot");
      if (target.userId) throw new MembershipError("That FPL slot belongs to your teammate.", 409, "slot-taken");
    }
    if (!target && slots.length >= maxMembersFor(format)) {
      throw new MembershipError("Pick which of your team's FPL slots is yours.", 409, "pick-slot");
    }
    await assertFplChangeAllowed(tx, leagueId, target?.fplId, details.fplId);
    await assertFplIdFree(tx, leagueId, slots, details.fplId, target?.id ?? null);

    const playerId = target?.id ?? generateId();
    if (target) await tx.update(players).set({ ...details, updatedAt: new Date() }).where(eq(players.id, playerId));
    else await tx.insert(players).values({ id: playerId, teamId, ...details });
    if (me.playerId !== playerId) await tx.update(teamMembers).set({ playerId }).where(eq(teamMembers.id, me.id));
    return { playerId, teamComplete: await refreshTeamComplete(teamId, tx) };
  });
}

/**
 * The owner fills in a partner who won't sign in: an FPL slot nobody is linked to, which the
 * partner takes over in their own setup if they do join later. Saving again edits that slot.
 */
export async function savePartnerByOwner(teamId: string, ownerUserId: string, details: PlayerDetails): Promise<{ playerId: string; teamComplete: boolean }> {
  return writeTx(async (tx) => {
    const members = await tx
      .select({ userId: teamMembers.userId, role: teamMembers.role, playerId: teamMembers.playerId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));
    const me = members.find((m) => m.userId === ownerUserId);
    if (me?.role !== "owner") throw new MembershipError("Only the team owner can do that.", 403, "not-owner");
    if (!me.playerId) throw new MembershipError("Add your own details first.", 409, "needs-own-slot");
    if (members.some((m) => m.userId !== ownerUserId && m.playerId)) {
      throw new MembershipError("Your partner has already added their own details.", 409, "partner-joined");
    }
    const { leagueId, format } = await teamLeague(tx, teamId);
    const slots = await teamSlots(teamId, tx);
    const open = slots.find((s) => !s.userId) ?? null;
    if (!open && slots.length >= maxMembersFor(format)) throw new MembershipError("Your team already has its full line-up.", 409, "team-full");
    await assertFplChangeAllowed(tx, leagueId, open?.fplId, details.fplId);
    await assertFplIdFree(tx, leagueId, slots, details.fplId, open?.id ?? null);

    const playerId = open?.id ?? generateId();
    if (open) await tx.update(players).set({ ...details, updatedAt: new Date() }).where(eq(players.id, playerId));
    else await tx.insert(players).values({ id: playerId, teamId, ...details });
    await audit(tx, "PARTNER_ENTERED", `Owner entered teammate ${details.name} (FPL ${details.fplId})`, { userId: ownerUserId, leagueId, teamId });
    return { playerId, teamComplete: await refreshTeamComplete(teamId, tx) };
  });
}

// ─── Approval mode ───────────────────────────────────────────────────────────

export async function fileJoinRequest(leagueId: string, userId: string, inviteId: string): Promise<string> {
  await assertNotSuperadmin(db, userId, SUPERADMIN_CANNOT_JOIN);
  if (await teamOfUserInLeague(userId, leagueId)) throw new MembershipError("You're already in this league.", 409, "already-member");
  const [existing] = await db
    .select({ id: joinRequests.id })
    .from(joinRequests)
    .where(and(eq(joinRequests.leagueId, leagueId), eq(joinRequests.userId, userId), eq(joinRequests.status, "pending")))
    .limit(1);
  if (existing) return existing.id;
  const id = generateId();
  await db.insert(joinRequests).values({ id, leagueId, userId, inviteId });
  await audit(db, "JOIN_REQUESTED", "Asked to join", { userId, leagueId });
  return id;
}

export async function pendingRequestFor(leagueId: string, userId: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: joinRequests.id })
    .from(joinRequests)
    .where(and(eq(joinRequests.leagueId, leagueId), eq(joinRequests.userId, userId), eq(joinRequests.status, "pending")))
    .limit(1);
  return row ?? null;
}

export async function cancelJoinRequest(leagueId: string, userId: string): Promise<boolean> {
  const done = await db
    .update(joinRequests)
    .set({ status: "cancelled", decidedAt: new Date() })
    .where(and(eq(joinRequests.leagueId, leagueId), eq(joinRequests.userId, userId), eq(joinRequests.status, "pending")))
    .returning({ id: joinRequests.id });
  return done.length > 0;
}

/** Approve: claim a slot for the requester (the same transaction as a direct join), then close the request. */
export async function approveJoinRequest(requestId: string, leagueId: string, adminUserId: string | null): Promise<string> {
  const [req] = await db.select().from(joinRequests).where(and(eq(joinRequests.id, requestId), eq(joinRequests.leagueId, leagueId))).limit(1);
  if (!req || req.status !== "pending") throw new MembershipError("That request is no longer waiting.", 409, "not-pending");
  const teamId = await claimOpenSlot(leagueId, req.userId, null);
  await db.update(joinRequests).set({ status: "approved", decidedByUserId: adminUserId, decidedAt: new Date() }).where(eq(joinRequests.id, requestId));
  await audit(db, "JOIN_APPROVED", "Join request approved", { userId: req.userId, leagueId, teamId });
  return teamId;
}

export async function rejectJoinRequest(requestId: string, leagueId: string, adminUserId: string | null): Promise<void> {
  const done = await db
    .update(joinRequests)
    .set({ status: "rejected", decidedByUserId: adminUserId, decidedAt: new Date() })
    .where(and(eq(joinRequests.id, requestId), eq(joinRequests.leagueId, leagueId), eq(joinRequests.status, "pending")))
    .returning({ userId: joinRequests.userId });
  if (done.length === 0) throw new MembershipError("That request is no longer waiting.", 409, "not-pending");
  await audit(db, "JOIN_REJECTED", "Join request rejected", { userId: done[0].userId, leagueId });
}

// ─── Admin tools ─────────────────────────────────────────────────────────────

export async function findUserByUsername(username: string) {
  const [u] = await db
    .select({ id: users.id, username: users.username, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.username, username.trim().replace(/^@/, "").toLowerCase()))
    .limit(1);
  return u ?? null;
}

/**
 * Put a person on a team: owner if the team has none, else teammate (up to the format's limit).
 * Like any joiner, they say which FPL slot is theirs in team setup.
 */
export async function assignToTeam(leagueId: string, teamId: string, userId: string, adminUserId: string | null): Promise<void> {
  try {
    await writeTx(async (tx) => {
      const [team] = await tx
        .select({ id: teams.id, name: teams.name, format: leagues.format })
        .from(teams)
        .innerJoin(leagues, eq(leagues.id, teams.leagueId))
        .where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId)))
        .limit(1);
      if (!team) throw new MembershipError("Team not found in this league.", 404);
      await assertNotSuperadmin(tx, userId, SUPERADMIN_CANNOT_BE_ASSIGNED);
      if (await alreadyInLeague(tx, userId, leagueId)) throw new MembershipError("That person is already on a team in this league.", 409, "already-member");
      const current = await tx.select({ role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
      if (current.length >= maxMembersFor(team.format)) throw new MembershipError("That team already has its full line-up.", 409, "team-full");
      const role = current.some((m) => m.role === "owner") ? "member" : "owner";
      await tx.insert(teamMembers).values({ id: generateId(), teamId, leagueId, userId, role });
      await audit(tx, "MEMBER_ASSIGNED", `Assigned to ${team.name} by admin ${adminUserId ?? "(system)"}`, { userId, leagueId, teamId });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new MembershipError("That person is already on a team in this league.", 409, "already-member");
    throw err;
  }
}

async function memberInLeague(memberId: string, leagueId: string) {
  const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.id, memberId), eq(teamMembers.leagueId, leagueId))).limit(1);
  if (!m) throw new MembershipError("Member not found in this league.", 404);
  return m;
}

/** Take someone off their team. If they owned it, their teammate becomes the owner. */
export async function removeMember(leagueId: string, memberId: string): Promise<void> {
  const m = await memberInLeague(memberId, leagueId);
  await writeTx(async (tx) => {
    await tx.delete(teamMembers).where(eq(teamMembers.id, m.id));
    if (m.role === "owner") {
      const [next] = await tx.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.teamId, m.teamId)).orderBy(asc(teamMembers.createdAt)).limit(1);
      if (next) await tx.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.id, next.id));
    }
    await audit(tx, "MEMBER_REMOVED", "Removed from team by an admin", { userId: m.userId, leagueId, teamId: m.teamId });
  });
}

/** Lost Google account: the same seat (role and FPL slot) passes to a different person. */
export async function replaceMemberAccount(leagueId: string, memberId: string, newUserId: string): Promise<void> {
  const m = await memberInLeague(memberId, leagueId);
  if (m.userId === newUserId) return;
  await assertNotSuperadmin(db, newUserId, SUPERADMIN_CANNOT_BE_ASSIGNED);
  if (await teamOfUserInLeague(newUserId, leagueId)) throw new MembershipError("That person is already on a team in this league.", 409, "already-member");
  await db.update(teamMembers).set({ userId: newUserId }).where(eq(teamMembers.id, m.id));
  await audit(db, "MEMBER_REPLACED", `Seat moved from ${m.userId} to ${newUserId}`, { userId: newUserId, leagueId, teamId: m.teamId });
}

export async function transferOwnership(leagueId: string, memberId: string): Promise<void> {
  const m = await memberInLeague(memberId, leagueId);
  if (m.role === "owner") return;
  await writeTx(async (tx) => {
    // One owner per team: demote first, then promote.
    await tx.update(teamMembers).set({ role: "member" }).where(and(eq(teamMembers.teamId, m.teamId), eq(teamMembers.role, "owner")));
    await tx.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.id, m.id));
    await audit(tx, "OWNER_TRANSFERRED", "Team ownership transferred", { userId: m.userId, leagueId, teamId: m.teamId });
  });
}

/** Free a team for someone else: everyone comes off it. The team, its history and its players stay. */
export async function releaseTeam(leagueId: string, teamId: string): Promise<void> {
  await writeTx(async (tx) => {
    const removed = await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.leagueId, leagueId))).returning({ userId: teamMembers.userId });
    await tx.update(leagueInvites).set({ revokedAt: new Date() }).where(and(eq(leagueInvites.teamId, teamId), isNull(leagueInvites.revokedAt)));
    await audit(tx, "TEAM_RELEASED", `Team released (${removed.length} member(s) removed)`, { leagueId, teamId });
  });
}

/**
 * Superadmin recovery: move every membership and league-admin assignment from one account to
 * another (a lost Google account). Refuses, rather than overwrites, wherever the target is already
 * in the same league; then revokes the old account's sessions.
 */
export async function transferAllMemberships(fromUserId: string, toUserId: string): Promise<{ moved: number; conflicts: string[] }> {
  if (fromUserId === toUserId) throw new MembershipError("Pick a different account.");
  return writeTx(async (tx) => {
    const fromRows = await tx.select().from(teamMembers).where(eq(teamMembers.userId, fromUserId));
    const toLeagues = new Set((await tx.select({ leagueId: teamMembers.leagueId }).from(teamMembers).where(eq(teamMembers.userId, toUserId))).map((r) => r.leagueId));
    const conflicts = fromRows.filter((r) => toLeagues.has(r.leagueId)).map((r) => r.leagueId);
    if (conflicts.length > 0) throw new MembershipError("The new account is already in some of these leagues.", 409, "conflict");
    const [from] = await tx.select({ role: users.role }).from(users).where(eq(users.id, fromUserId)).limit(1);
    const [to] = await tx.select({ role: users.role }).from(users).where(eq(users.id, toUserId)).limit(1);
    // The new account ends up with the higher of the two roles; a superadmin can't keep any teams.
    const endsSuperadmin = from?.role === "superadmin" || to?.role === "superadmin";
    if (endsSuperadmin && (fromRows.length > 0 || toLeagues.size > 0)) {
      throw new MembershipError("Superadmins can't be on a team. Take the account off its teams first.", 409, "superadmin");
    }
    if (fromRows.length > 0) {
      await tx.update(teamMembers).set({ userId: toUserId }).where(inArray(teamMembers.id, fromRows.map((r) => r.id)));
    }
    const adminRows = await tx.select().from(leagueAdmins).where(eq(leagueAdmins.userId, fromUserId));
    const toAdmin = new Set((await tx.select({ leagueId: leagueAdmins.leagueId }).from(leagueAdmins).where(eq(leagueAdmins.userId, toUserId))).map((r) => r.leagueId));
    for (const a of adminRows) {
      if (toAdmin.has(a.leagueId)) await tx.delete(leagueAdmins).where(eq(leagueAdmins.id, a.id));
      else await tx.update(leagueAdmins).set({ userId: toUserId }).where(eq(leagueAdmins.id, a.id));
    }
    const rank = (r?: string) => (r === "superadmin" ? 2 : r === "admin" ? 1 : 0);
    if (rank(from?.role) > rank(to?.role)) await tx.update(users).set({ role: from!.role }).where(eq(users.id, toUserId));
    await tx.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, fromUserId));
    await audit(tx, "ACCOUNT_TRANSFERRED", `Memberships moved to ${toUserId}`, { userId: fromUserId });
    return { moved: fromRows.length + adminRows.length, conflicts: [] };
  });
}

/** Teams with their members and slot state, for the admin Members tab. */
export async function leagueRoster(leagueId: string) {
  const teamRows = await db
    .select({ id: teams.id, name: teams.name, teamKey: teams.teamLoginId, isProfileComplete: teams.isProfileComplete })
    .from(teams)
    .where(and(eq(teams.leagueId, leagueId), eq(teams.isGhost, false)))
    .orderBy(asc(teams.createdAt), asc(teams.id));
  const members = await db
    .select({ id: teamMembers.id, teamId: teamMembers.teamId, role: teamMembers.role, userId: users.id, username: users.username, name: users.name, email: users.email })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.leagueId, leagueId))
    .orderBy(asc(teamMembers.createdAt));
  const requests = await db
    .select({ id: joinRequests.id, createdAt: joinRequests.createdAt, userId: users.id, username: users.username, name: users.name, email: users.email })
    .from(joinRequests)
    .innerJoin(users, eq(users.id, joinRequests.userId))
    .where(and(eq(joinRequests.leagueId, leagueId), eq(joinRequests.status, "pending")))
    .orderBy(asc(joinRequests.createdAt));
  const now = new Date();
  const [invite] = await db
    .select()
    .from(leagueInvites)
    .where(and(eq(leagueInvites.leagueId, leagueId), isNull(leagueInvites.teamId), isNull(leagueInvites.revokedAt), or(isNull(leagueInvites.expiresAt), gt(leagueInvites.expiresAt, now))))
    .orderBy(sql`${leagueInvites.createdAt} DESC`)
    .limit(1);
  return {
    teams: teamRows.map((t) => {
      const m = members.filter((x) => x.teamId === t.id);
      return { ...t, state: m.length === 0 ? "open" : t.isProfileComplete ? "set-up" : "claimed", members: m };
    }),
    requests: requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    invite: invite ?? null,
  };
}
