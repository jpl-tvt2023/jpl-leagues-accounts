/**
 * The auction room's state as one JSON snapshot: sessions, the current session's turn and open lot,
 * each team's purse and how much it may bid on the lot, franchises with their current opening
 * price, and recent sales. The SSE stream sends it whenever it changes; the room renders only this.
 */

import { and, asc, count, eq } from "drizzle-orm";
import { db, cricketAuctionSessions, cricketAuctionLots } from "@/lib/db";
import { nextMinBid, squadCap } from "./rules";
import { checkFranchisePurchase, checkPlayerPurchase, franchiseOpening, loadAuctionData, maxBidFor } from "./data";
import { getOpenLot, parseIdList } from "./engine";
import { recentSales } from "./actions";

export interface SnapshotLot {
  id: string;
  kind: "player" | "franchise";
  playerId: number | null;
  cricketTeamId: number | null;
  name: string;
  openingPrice: number;
  currentHighBid: number;
  currentHighBidderId: string;
  nominatorTeamId: string;
  expiresAt: string;
  nextMinBid: number;
  lotNumber: number;
}

export interface AuctionSnapshot {
  serverTime: string;
  leagueId: string;
  sessions: Array<{ id: string; type: "franchise" | "player"; status: "pending" | "active" | "paused" | "completed"; scheduledAt: string | null; startedAt: string | null; completedAt: string | null }>;
  current: null | {
    sessionId: string;
    type: "franchise" | "player";
    status: "pending" | "active" | "paused" | "completed";
    ring: string[];
    currentNominatorIndex: number;
    nominatorTeamId: string | null;
    nominationDeadline: string | null;
    intermissionUntil: string | null;
    makeupQueue: string[];
    bidTimerSeconds: number;
    lot: SnapshotLot | null;
  };
  teams: Array<{
    id: string;
    name: string;
    purse: number;
    squadSize: number;
    cap: number;
    penaltySlots: number;
    franchiseId: number | null;
    /** Most this team may bid on the open lot (or on a new nomination); 0 when it can't. */
    maxBid: number;
    /** May bid on the open lot right now. */
    canBid: boolean;
  }>;
  franchises: Array<{ id: number; code: string; name: string; basePrice: number; openingPrice: number; ownerTeamId: string | null }>;
  sales: Array<{ lotId: string; kind: "player" | "franchise"; name: string; teamId: string; price: number; at: string }>;
}

/** The session the room should show: a running one, else the next to run, else the last finished. */
function pickCurrent<T extends { status: string }>(sessions: T[]): T | null {
  return (
    sessions.find((s) => s.status === "active" || s.status === "paused") ??
    sessions.find((s) => s.status === "pending") ??
    [...sessions].reverse().find((s) => s.status === "completed") ??
    null
  );
}

export async function buildAuctionSnapshot(leagueId: string): Promise<AuctionSnapshot | null> {
  const data = await loadAuctionData(leagueId);
  if (!data) return null;
  const lid = data.info.league.id;
  const sessions = await db.select().from(cricketAuctionSessions).where(eq(cricketAuctionSessions.leagueId, lid)).orderBy(asc(cricketAuctionSessions.createdAt));
  const current = pickCurrent(sessions);
  const lot = current ? await getOpenLot(current.id) : null;
  const [sold] = current
    ? await db
        .select({ n: count() })
        .from(cricketAuctionLots)
        .where(and(eq(cricketAuctionLots.sessionId, current.id), eq(cricketAuctionLots.status, "sold")))
    : [{ n: 0 }];
  const ring = current ? parseIdList(current.ringOrder) : [];
  const rules = data.info.config.squadRules;
  const sales = await recentSales(lid, 20);

  return {
    serverTime: new Date().toISOString(),
    leagueId: lid,
    sessions: sessions.map((s) => ({
      id: s.id,
      type: s.type,
      status: s.status,
      scheduledAt: s.scheduledAt?.toISOString() ?? null,
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
    current: current && {
      sessionId: current.id,
      type: current.type,
      status: current.status,
      ring,
      currentNominatorIndex: current.currentNominatorIndex,
      nominatorTeamId: ring[current.currentNominatorIndex] ?? null,
      nominationDeadline: current.nominationDeadline?.toISOString() ?? null,
      intermissionUntil: current.intermissionUntil?.toISOString() ?? null,
      makeupQueue: parseIdList(current.makeupQueue),
      bidTimerSeconds: current.bidTimerSeconds,
      lot: lot && {
        id: lot.id,
        kind: lot.lotKind,
        playerId: lot.playerId,
        cricketTeamId: lot.cricketTeamId,
        name: lot.name,
        openingPrice: lot.openingPrice,
        currentHighBid: lot.currentHighBid,
        currentHighBidderId: lot.currentHighBidderId,
        nominatorTeamId: lot.nominatorTeamId,
        expiresAt: lot.expiresAt.toISOString(),
        nextMinBid: nextMinBid(lot.currentHighBid),
        lotNumber: sold.n + 1,
      },
    },
    teams: [...data.teams.values()]
      .map((t) => {
        const kind = lot?.lotKind ?? current?.type ?? "player";
        const maxBid = Math.max(0, maxBidFor(data, t.id, kind, lot?.playerId ?? undefined));
        const min = lot ? nextMinBid(lot.currentHighBid) : 0;
        const canBid =
          !!lot &&
          lot.currentHighBidderId !== t.id &&
          (lot.lotKind === "player" ? checkPlayerPurchase(data, t.id, lot.playerId!, min).ok : checkFranchisePurchase(data, t.id, lot.cricketTeamId!, min).ok);
        return {
          id: t.id,
          name: t.name,
          purse: t.purse,
          squadSize: t.squad.size,
          cap: squadCap(rules, t.penaltySlots),
          penaltySlots: t.penaltySlots,
          franchiseId: t.franchiseId,
          maxBid,
          canBid,
        };
      })
      .sort((a, b) => ring.indexOf(a.id) - ring.indexOf(b.id) || a.name.localeCompare(b.name)),
    franchises: [...data.pool.realTeams.values()]
      .map((t) => ({ id: t.id, code: t.code, name: t.name, basePrice: t.basePrice, openingPrice: franchiseOpening(data, t.id), ownerTeamId: data.franchiseOwner.get(t.id) ?? null }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    sales: sales.map((s) => ({ lotId: s.lotId, kind: s.kind, name: s.name, teamId: s.teamId, price: s.price, at: s.at.toISOString() })),
  };
}

/** The current session id, for the stream to tick. */
export function currentSessionId(snapshot: AuctionSnapshot): string | null {
  return snapshot.current?.sessionId ?? null;
}
