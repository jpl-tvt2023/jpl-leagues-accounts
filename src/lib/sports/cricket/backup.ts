/**
 * Cricket league backups: the league's auction state as one JSON payload — teams (names, purses),
 * squads, franchises, penalties and sessions — downloadable as a zip, stored as snapshots, and
 * restorable. The cricket counterpart of the FPL console's Backup tab (lib/sports/fpl/backup/*).
 *
 * Players and franchises are recorded by their codes (player_id, team_code), not internal ids, so a
 * backup stays valid when the tournament's data is re-uploaded. Restore replaces the league's
 * auction state wholesale and writes one sold lot per purchase, so undo, move and the sales feed
 * keep working afterwards.
 */

import * as XLSX from "xlsx";
import JSZip from "jszip";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  teams,
  cricketPlayers,
  cricketTeams,
  cricketTeamState,
  cricketSquadPlayers,
  cricketFranchiseOwnership,
  cricketTeamPenalties,
  cricketAuctionSessions,
  cricketAuctionLots,
  cricketAuctionBidLogs,
  cricketAuctionTurnEvents,
  cricketLeagueConfig,
  cricketBackups,
} from "@/lib/db";
import { generateId } from "@/lib/id";
import { CricketAdminError, requireCricketLeague, settingsOf } from "./admin";
import type { CricketLeagueSettings } from "./league-settings";

export const BACKUP_VERSION = 1;

export interface CricketBackup {
  version: typeof BACKUP_VERSION;
  takenAt: string;
  league: { id: string; slug: string; name: string };
  tournament: { id: string; name: string; dataVersion: number };
  settings: CricketLeagueSettings;
  completedAt: string | null;
  teams: Array<{ id: string; name: string; purse: number; spent: number; penaltySlots: number }>;
  squads: Array<{ teamId: string; playerCode: string; playerName: string; price: number }>;
  franchises: Array<{ teamId: string; teamCode: string; teamName: string; price: number }>;
  penalties: Array<{ teamId: string; createdAt: string; redeemedAt: string | null; redemptionPrice: number | null }>;
  sessions: Array<{
    type: "franchise" | "player";
    status: "pending" | "active" | "paused" | "completed";
    ringOrder: string[];
    currentNominatorIndex: number;
    bidTimerSeconds: number;
    nominationTimeoutSeconds: number;
    intermissionSeconds: number;
    scheduledAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const parseIds = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** The league's auction state now. */
export async function buildBackup(leagueId: string): Promise<CricketBackup> {
  const info = await requireCricketLeague(leagueId);
  const lid = info.league.id;
  const [teamRows, squads, franchises, penalties, sessions] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name, purse: cricketTeamState.purse, spent: cricketTeamState.spent, penaltySlots: cricketTeamState.penaltySlots })
      .from(teams)
      .innerJoin(cricketTeamState, eq(cricketTeamState.teamId, teams.id))
      .where(eq(teams.leagueId, lid))
      .orderBy(asc(teams.name)),
    db
      .select({ teamId: cricketSquadPlayers.teamId, code: cricketPlayers.code, name: cricketPlayers.name, price: cricketSquadPlayers.price })
      .from(cricketSquadPlayers)
      .innerJoin(cricketPlayers, eq(cricketPlayers.id, cricketSquadPlayers.playerId))
      .where(eq(cricketSquadPlayers.leagueId, lid)),
    db
      .select({ teamId: cricketFranchiseOwnership.teamId, code: cricketTeams.code, name: cricketTeams.name, price: cricketFranchiseOwnership.price })
      .from(cricketFranchiseOwnership)
      .innerJoin(cricketTeams, eq(cricketTeams.id, cricketFranchiseOwnership.cricketTeamId))
      .where(eq(cricketFranchiseOwnership.leagueId, lid)),
    db.select().from(cricketTeamPenalties).where(eq(cricketTeamPenalties.leagueId, lid)).orderBy(asc(cricketTeamPenalties.createdAt)),
    db.select().from(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, lid)).orderBy(asc(cricketAuctionSessions.createdAt)),
  ]);
  return {
    version: BACKUP_VERSION,
    takenAt: new Date().toISOString(),
    league: { id: lid, slug: info.league.slug, name: info.league.name },
    tournament: { id: info.tournament.id, name: info.tournament.name, dataVersion: info.tournament.dataVersion },
    settings: settingsOf(info),
    completedAt: info.config.completedAt ?? null,
    teams: teamRows,
    squads: squads.map((s) => ({ teamId: s.teamId, playerCode: s.code, playerName: s.name, price: s.price })),
    franchises: franchises.map((f) => ({ teamId: f.teamId, teamCode: f.code, teamName: f.name, price: f.price })),
    penalties: penalties.map((p) => ({ teamId: p.teamId, createdAt: p.createdAt.toISOString(), redeemedAt: iso(p.redeemedAt), redemptionPrice: p.redemptionPrice })),
    sessions: sessions.map((s) => ({
      type: s.type,
      status: s.status,
      ringOrder: parseIds(s.ringOrder),
      currentNominatorIndex: s.currentNominatorIndex,
      bidTimerSeconds: s.bidTimerSeconds,
      nominationTimeoutSeconds: s.nominationTimeoutSeconds,
      intermissionSeconds: s.intermissionSeconds,
      scheduledAt: iso(s.scheduledAt),
      startedAt: iso(s.startedAt),
      completedAt: iso(s.completedAt),
    })),
  };
}

function sheet(rows: Record<string, unknown>[], name: string): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** backup.json (what restore reads) plus readable sheets. */
export async function backupZip(b: CricketBackup): Promise<ArrayBuffer> {
  const teamName = new Map(b.teams.map((t) => [t.id, t.name]));
  const zip = new JSZip();
  zip.file("backup.json", JSON.stringify(b, null, 2));
  zip.file("teams.xlsx", sheet(b.teams.map((t) => ({ team: t.name, purse: t.purse, spent: t.spent, penalty_slots: t.penaltySlots })), "Teams"));
  zip.file("squads.xlsx", sheet(b.squads.map((s) => ({ team: teamName.get(s.teamId) ?? s.teamId, player: s.playerName, player_id: s.playerCode, price: s.price })), "Squads"));
  zip.file("franchises.xlsx", sheet(b.franchises.map((f) => ({ team: teamName.get(f.teamId) ?? f.teamId, franchise: f.teamName, team_code: f.teamCode, price: f.price })), "Franchises"));
  zip.file(
    "penalties.xlsx",
    sheet(b.penalties.map((p) => ({ team: teamName.get(p.teamId) ?? p.teamId, incurred: p.createdAt, redeemed: p.redeemedAt ?? "", price: p.redemptionPrice ?? "" })), "Penalties"),
  );
  zip.file("settings.xlsx", sheet(Object.entries(b.settings).map(([key, value]) => ({ setting: key, value: typeof value === "object" ? JSON.stringify(value) : value })), "Settings"));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

export function backupFileName(slug: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `cricket-backup-${slug}-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}.zip`;
}

/** The backup.json inside an uploaded zip. Only JSON is read from the file. */
export async function backupFromZip(data: ArrayBuffer): Promise<unknown> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new CricketAdminError("That isn't a backup .zip", 400);
  }
  const file = zip.file("backup.json");
  if (!file) throw new CricketAdminError("The zip has no backup.json — is it a cricket backup?", 400);
  try {
    return JSON.parse(await file.async("string"));
  } catch {
    throw new CricketAdminError("backup.json can't be read", 400);
  }
}

// ─── Stored snapshots ─────────────────────────────────────────────────────────

export async function saveSnapshot(leagueId: string, trigger: "manual" | "player-auction-complete", userId: string | null): Promise<{ id: string; createdAt: Date }> {
  const b = await buildBackup(leagueId);
  const id = generateId();
  const createdAt = new Date();
  await db.insert(cricketBackups).values({ id, leagueId: b.league.id, trigger, createdBy: userId, payload: JSON.stringify(b), createdAt });
  return { id, createdAt };
}

export async function listSnapshots(leagueId: string) {
  const rows = await db
    .select({ id: cricketBackups.id, trigger: cricketBackups.trigger, createdAt: cricketBackups.createdAt, payload: cricketBackups.payload })
    .from(cricketBackups)
    .where(eq(cricketBackups.leagueId, leagueId))
    .orderBy(desc(cricketBackups.createdAt))
    .limit(50);
  return rows.map((r) => {
    const b = JSON.parse(r.payload) as CricketBackup;
    return { id: r.id, trigger: r.trigger, createdAt: r.createdAt, squads: b.squads.length, franchises: b.franchises.length };
  });
}

export async function getSnapshot(leagueId: string, backupId: string): Promise<{ backup: CricketBackup; createdAt: Date } | null> {
  const [row] = await db.select().from(cricketBackups).where(and(eq(cricketBackups.id, backupId), eq(cricketBackups.leagueId, leagueId))).limit(1);
  return row ? { backup: JSON.parse(row.payload) as CricketBackup, createdAt: row.createdAt } : null;
}

// ─── Restore ──────────────────────────────────────────────────────────────────

/** What a restore would do, or why it can't. Nothing is written unless `errors` is empty. */
export interface RestoreCheck {
  errors: string[];
  counts: { teams: number; squads: number; franchises: number; penalties: number; sessions: number };
}

function shapeOk(b: unknown): b is CricketBackup {
  const x = b as CricketBackup;
  return (
    !!x &&
    x.version === BACKUP_VERSION &&
    Array.isArray(x.teams) &&
    Array.isArray(x.squads) &&
    Array.isArray(x.franchises) &&
    Array.isArray(x.penalties) &&
    Array.isArray(x.sessions)
  );
}

/**
 * Replace the league's auction state with a backup's. Refused (nothing written) when the backup is
 * for another league, names a team, player or franchise this league's tournament doesn't have, or
 * an auction session is running.
 */
export async function restoreBackup(leagueId: string, raw: unknown): Promise<RestoreCheck> {
  const info = await requireCricketLeague(leagueId);
  const lid = info.league.id;
  if (!shapeOk(raw)) throw new CricketAdminError("This isn't a cricket backup this version of the site can read", 400);
  const b = raw;
  const errors: string[] = [];
  if (b.league.id !== lid) errors.push(`This backup is of ${b.league.name} (${b.league.slug}), not this league`);

  const [leagueTeams, players, realTeams, running] = await Promise.all([
    db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, lid)),
    db.select({ id: cricketPlayers.id, code: cricketPlayers.code }).from(cricketPlayers).where(eq(cricketPlayers.tournamentId, info.tournament.id)),
    db.select({ id: cricketTeams.id, code: cricketTeams.code, name: cricketTeams.name }).from(cricketTeams).where(eq(cricketTeams.tournamentId, info.tournament.id)),
    db
      .select({ id: cricketAuctionSessions.id })
      .from(cricketAuctionSessions)
      .where(and(eq(cricketAuctionSessions.leagueId, lid), eq(cricketAuctionSessions.status, "active"))),
  ]);
  if (running.length) errors.push("An auction session is running — pause it first");
  const teamIds = new Set(leagueTeams.map((t) => t.id));
  const playerByCode = new Map(players.map((p) => [p.code, p.id]));
  const realByCode = new Map(realTeams.map((t) => [t.code, t]));
  for (const t of b.teams) if (!teamIds.has(t.id)) errors.push(`Team "${t.name}" isn't in this league`);
  const seenPlayers = new Set<string>();
  for (const s of b.squads) {
    if (!teamIds.has(s.teamId)) errors.push(`${s.playerName}'s team isn't in this league`);
    if (!playerByCode.has(s.playerCode)) errors.push(`No player ${s.playerName} (${s.playerCode}) in ${info.tournament.name} any more`);
    if (seenPlayers.has(s.playerCode)) errors.push(`${s.playerName} is in two squads`);
    seenPlayers.add(s.playerCode);
  }
  const seenFranchise = new Set<string>();
  const seenOwner = new Set<string>();
  for (const f of b.franchises) {
    if (!realByCode.has(f.teamCode)) errors.push(`No franchise ${f.teamName} (${f.teamCode}) in ${info.tournament.name} any more`);
    if (seenFranchise.has(f.teamCode)) errors.push(`${f.teamName} has two owners`);
    if (seenOwner.has(f.teamId)) errors.push("A team owns two franchises");
    seenFranchise.add(f.teamCode);
    seenOwner.add(f.teamId);
  }
  const counts = { teams: b.teams.length, squads: b.squads.length, franchises: b.franchises.length, penalties: b.penalties.length, sessions: b.sessions.length };
  if (errors.length) return { errors: [...new Set(errors)], counts };

  // Wipe the auction state (as resetAuction does) and write the backup's back, in one batch.
  const now = new Date();
  const lotIds = (await db.select({ id: cricketAuctionLots.id }).from(cricketAuctionLots).where(eq(cricketAuctionLots.leagueId, lid))).map((l) => l.id);
  const date = (s: string | null) => (s ? new Date(s) : null);
  const sessionIdByType = new Map<string, string>();
  const sessionRows = b.sessions.map((s) => {
    const id = generateId();
    if (!sessionIdByType.has(s.type)) sessionIdByType.set(s.type, id);
    const status = s.status === "active" ? "paused" : s.status; // never restore into a live clock
    return {
      id,
      leagueId: lid,
      type: s.type,
      status,
      ringOrder: JSON.stringify(s.ringOrder.filter((t) => teamIds.has(t))),
      currentNominatorIndex: s.currentNominatorIndex,
      bidTimerSeconds: s.bidTimerSeconds,
      nominationTimeoutSeconds: s.nominationTimeoutSeconds,
      intermissionSeconds: s.intermissionSeconds,
      scheduledAt: date(s.scheduledAt),
      startedAt: date(s.startedAt),
      completedAt: date(s.completedAt),
      pausedAt: status === "paused" ? now : null,
    } as const;
  });
  // Purchases need a session to hang off; a backup always has one, but be safe.
  for (const type of ["player", "franchise"] as const) {
    const needed = type === "player" ? b.squads.length : b.franchises.length;
    if (needed && !sessionIdByType.has(type)) {
      const id = generateId();
      sessionIdByType.set(type, id);
      sessionRows.push({
        id, leagueId: lid, type, status: "completed", ringOrder: "[]", currentNominatorIndex: 0, bidTimerSeconds: info.config.bidTimerSeconds,
        nominationTimeoutSeconds: info.config.nominationTimeoutSeconds, intermissionSeconds: 5, scheduledAt: null, startedAt: now, completedAt: now, pausedAt: null,
      });
    }
  }
  const lots: Array<typeof cricketAuctionLots.$inferInsert> = [];
  const squadRows: Array<typeof cricketSquadPlayers.$inferInsert> = [];
  const franchiseRows: Array<typeof cricketFranchiseOwnership.$inferInsert> = [];
  for (const s of b.squads) {
    const lotId = generateId();
    const sessionId = sessionIdByType.get("player")!;
    const playerId = playerByCode.get(s.playerCode)!;
    lots.push({ id: lotId, leagueId: lid, sessionId, lotKind: "player", playerId, name: s.playerName, nominatorTeamId: s.teamId, openingPrice: s.price, currentHighBid: s.price, currentHighBidderId: s.teamId, status: "sold", expiresAt: now });
    squadRows.push({ id: generateId(), leagueId: lid, teamId: s.teamId, playerId, price: s.price, sessionId, lotId });
  }
  for (const f of b.franchises) {
    const lotId = generateId();
    const sessionId = sessionIdByType.get("franchise")!;
    const real = realByCode.get(f.teamCode)!;
    lots.push({ id: lotId, leagueId: lid, sessionId, lotKind: "franchise", cricketTeamId: real.id, name: real.name, nominatorTeamId: f.teamId, openingPrice: f.price, currentHighBid: f.price, currentHighBidderId: f.teamId, status: "sold", expiresAt: now });
    franchiseRows.push({ id: generateId(), leagueId: lid, teamId: f.teamId, cricketTeamId: real.id, price: f.price, sessionId, lotId });
  }
  const chunk = <T,>(items: T[], size = 200) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

  await db.batch([
    db.delete(cricketSquadPlayers).where(eq(cricketSquadPlayers.leagueId, lid)),
    ...(lotIds.length ? [db.delete(cricketAuctionBidLogs).where(inArray(cricketAuctionBidLogs.lotId, lotIds))] : []),
    db.delete(cricketFranchiseOwnership).where(eq(cricketFranchiseOwnership.leagueId, lid)),
    db.delete(cricketTeamPenalties).where(eq(cricketTeamPenalties.leagueId, lid)),
    db.delete(cricketAuctionTurnEvents).where(eq(cricketAuctionTurnEvents.leagueId, lid)),
    db.delete(cricketAuctionLots).where(eq(cricketAuctionLots.leagueId, lid)),
    db.delete(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, lid)),
    ...(sessionRows.length ? [db.insert(cricketAuctionSessions).values(sessionRows)] : []),
    ...chunk(lots).map((c) => db.insert(cricketAuctionLots).values(c)),
    ...chunk(squadRows).map((c) => db.insert(cricketSquadPlayers).values(c)),
    ...chunk(franchiseRows).map((c) => db.insert(cricketFranchiseOwnership).values(c)),
    ...(b.penalties.length
      ? [
          db.insert(cricketTeamPenalties).values(
            b.penalties.map((p) => ({ id: generateId(), leagueId: lid, teamId: p.teamId, createdAt: new Date(p.createdAt), redeemedAt: date(p.redeemedAt), redemptionPrice: p.redemptionPrice })),
          ),
        ]
      : []),
    ...b.teams.flatMap((t) => [
      db.update(cricketTeamState).set({ purse: t.purse, spent: t.spent, penaltySlots: t.penaltySlots, updatedAt: now }).where(eq(cricketTeamState.teamId, t.id)),
      db.update(teams).set({ name: t.name }).where(eq(teams.id, t.id)),
    ]),
    db
      .update(cricketLeagueConfig)
      .set({ completedAt: date(b.completedAt), stateVersion: sql`${cricketLeagueConfig.stateVersion} + 1`, updatedAt: now })
      .where(eq(cricketLeagueConfig.leagueId, lid)),
  ]);
  return { errors: [], counts };
}
