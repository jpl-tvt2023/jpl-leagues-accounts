/**
 * Members-mode leagues: invites, joining, teammates, approvals and the admin's membership tools.
 * See docs/10-accounts-and-membership.md ("Members-mode leagues").
 *
 * Every change that touches more than one row runs in a transaction. The database's unique
 * indexes are the final word on races — one team per person per league, one owner per team —
 * so two people tapping the same invite at the same moment can't both get the same slot.
 */

import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import {
  auditLogs,
  db,
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

/** Most people per team, by format. TVT and Continental teams are two FPL managers. */
export const MAX_TEAM_MEMBERS: Record<string, number> = {
  tvt: 2,
  "continental-championship": 2,
  auction: 1,
};

export function maxMembersFor(format: string): number {
  return MAX_TEAM_MEMBERS[format] ?? 1;
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

/** The team's FPL slot no member is linked to yet — where a new teammate goes. */
async function freePlayerSlot(dbx: Db, teamId: string): Promise<string | null> {
  const teamPlayers = await dbx.select({ id: players.id }).from(players).where(eq(players.teamId, teamId)).orderBy(asc(players.createdAt), asc(players.id));
  const taken = new Set(
    (await dbx.select({ playerId: teamMembers.playerId }).from(teamMembers).where(eq(teamMembers.teamId, teamId))).map((r) => r.playerId),
  );
  return teamPlayers.find((p) => !taken.has(p.id))?.id ?? null;
}

/** Join a specific team as its owner's teammate, through a partner invite. */
export async function joinAsPartner(invite: LeagueInvite, userId: string): Promise<string> {
  if (!invite.teamId) throw new MembershipError("Not a teammate invite.");
  const teamId = invite.teamId;
  try {
    return await writeTx(async (tx) => {
      if (await alreadyInLeague(tx, userId, invite.leagueId)) throw new MembershipError("You're already in this league.", 409, "already-member");
      const [league] = await tx.select({ format: leagues.format }).from(leagues).where(eq(leagues.id, invite.leagueId)).limit(1);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)` }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
      if (Number(n) >= maxMembersFor(league?.format ?? "")) throw new MembershipError("This team already has its full line-up.", 409, "team-full");
      if (!(await spendInvite(tx, invite.id))) throw new MembershipError("This invite has already been used.", 410, "used-up");
      const role = Number(n) === 0 ? "owner" : "member";
      await tx.insert(teamMembers).values({ id: generateId(), teamId, leagueId: invite.leagueId, userId, role, playerId: await freePlayerSlot(tx, teamId) });
      await audit(tx, "MEMBER_JOINED", "Joined as teammate via invite", { userId, leagueId: invite.leagueId, teamId });
      return teamId;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new MembershipError("You're already in this league.", 409, "already-member");
    throw err;
  }
}

// ─── Approval mode ───────────────────────────────────────────────────────────

export async function fileJoinRequest(leagueId: string, userId: string, inviteId: string): Promise<string> {
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

/** Put a person on a team: owner if the team has none, else teammate (up to the format's limit). */
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
      if (await alreadyInLeague(tx, userId, leagueId)) throw new MembershipError("That person is already on a team in this league.", 409, "already-member");
      const current = await tx.select({ role: teamMembers.role }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
      if (current.length >= maxMembersFor(team.format)) throw new MembershipError("That team already has its full line-up.", 409, "team-full");
      const role = current.some((m) => m.role === "owner") ? "member" : "owner";
      await tx.insert(teamMembers).values({ id: generateId(), teamId, leagueId, userId, role, playerId: role === "member" ? await freePlayerSlot(tx, teamId) : null });
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
    if (fromRows.length > 0) {
      await tx.update(teamMembers).set({ userId: toUserId }).where(inArray(teamMembers.id, fromRows.map((r) => r.id)));
    }
    const adminRows = await tx.select().from(leagueAdmins).where(eq(leagueAdmins.userId, fromUserId));
    const toAdmin = new Set((await tx.select({ leagueId: leagueAdmins.leagueId }).from(leagueAdmins).where(eq(leagueAdmins.userId, toUserId))).map((r) => r.leagueId));
    for (const a of adminRows) {
      if (toAdmin.has(a.leagueId)) await tx.delete(leagueAdmins).where(eq(leagueAdmins.id, a.id));
      else await tx.update(leagueAdmins).set({ userId: toUserId }).where(eq(leagueAdmins.id, a.id));
    }
    const [from] = await tx.select({ role: users.role }).from(users).where(eq(users.id, fromUserId)).limit(1);
    const [to] = await tx.select({ role: users.role }).from(users).where(eq(users.id, toUserId)).limit(1);
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
