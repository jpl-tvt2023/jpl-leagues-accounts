/**
 * GET  /api/admin/[leagueId]/cricket/auction — the room snapshot plus admin extras (turn events,
 *      squads still short of the minimum).
 * POST /api/admin/[leagueId]/cricket/auction — { action, … }:
 *        create { type, scheduledAt?, bidTimerSeconds?, nominationTimeoutSeconds? }
 *        schedule { sessionId, scheduledAt } · delete { sessionId } · start / pause / resume { sessionId }
 *        complete { sessionId, force? } · cancel-lot { sessionId } · undo-sale { lotId }
 *        transfer-sale { lotId, toTeamId, price? } (price defaults to the sale price)
 *        grant-turn { sessionId, teamId } · nominate { sessionId, playerId | cricketTeamId }
 *        reset · simulate (superadmin only)
 *
 * League admins and the superadmin may run a cricket league's auction.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthorizedLeagueId } from "@/lib/league-auth";
import { isSuperAdmin } from "@/lib/privilege";
import { buildAuctionSnapshot } from "@/lib/sports/cricket/auction/snapshot";
import { nominateLot, tick } from "@/lib/sports/cricket/auction/engine";
import {
  cancelOpenLot,
  completeSession,
  createSession,
  deletePendingSession,
  grantMakeupTurn,
  pauseSession,
  recentTurnEvents,
  resetAuction,
  resumeSession,
  scheduleSession,
  shortSquads,
  simulateAuction,
  startSession,
  transferSale,
  undoSale,
} from "@/lib/sports/cricket/auction/actions";
import { requireCricketLeague } from "@/lib/sports/cricket/admin";
import { errorResponse } from "@/lib/sports/cricket/http";

export async function GET(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await requireCricketLeague(leagueId);
    let snap = await buildAuctionSnapshot(leagueId);
    if (snap?.current?.status === "active") {
      // Best-effort, as in the room's state read: a colliding write mustn't blank the monitor.
      try {
        await tick(snap.current.sessionId, "rest");
        snap = await buildAuctionSnapshot(leagueId);
      } catch (err) {
        console.warn("cricket admin auction: tick skipped:", err instanceof Error ? err.message : err);
      }
    }
    const [events, short] = await Promise.all([snap?.current ? recentTurnEvents(snap.current.sessionId) : Promise.resolve([]), shortSquads(leagueId)]);
    return NextResponse.json({ ...snap, events, short }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "cricket admin auction GET");
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(request: NextRequest) {
  const leagueId = await getAuthorizedLeagueId(request);
  if (!leagueId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await requireCricketLeague(leagueId);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = str(b.sessionId);
    const when = (v: unknown) => (typeof v === "string" && v ? new Date(v) : null);
    let result: { ok: boolean; status?: number; error?: string } & Record<string, unknown>;
    switch (b.action) {
      case "create":
        if (b.type !== "franchise" && b.type !== "player") return NextResponse.json({ error: "type must be franchise or player" }, { status: 400 });
        result = await createSession(leagueId, b.type, {
          scheduledAt: when(b.scheduledAt),
          bidTimerSeconds: typeof b.bidTimerSeconds === "number" ? b.bidTimerSeconds : undefined,
          nominationTimeoutSeconds: typeof b.nominationTimeoutSeconds === "number" ? b.nominationTimeoutSeconds : undefined,
        });
        break;
      case "schedule":
        result = await scheduleSession(leagueId, sessionId, when(b.scheduledAt));
        break;
      case "delete":
        result = await deletePendingSession(leagueId, sessionId);
        break;
      case "start":
        result = await startSession(leagueId, sessionId);
        break;
      case "pause":
        result = await pauseSession(leagueId, sessionId);
        break;
      case "resume":
        result = await resumeSession(leagueId, sessionId);
        break;
      case "complete":
        result = await completeSession(leagueId, sessionId, b.force === true);
        break;
      case "cancel-lot":
        result = await cancelOpenLot(leagueId, sessionId);
        break;
      case "undo-sale":
        result = await undoSale(leagueId, str(b.lotId));
        break;
      case "transfer-sale":
        if (b.price !== undefined && b.price !== null && typeof b.price !== "number") return NextResponse.json({ error: "price must be a number" }, { status: 400 });
        result = await transferSale(leagueId, str(b.lotId), str(b.toTeamId), typeof b.price === "number" ? b.price : undefined);
        break;
      case "grant-turn":
        result = await grantMakeupTurn(leagueId, sessionId, str(b.teamId));
        break;
      case "nominate": {
        const target = typeof b.playerId === "number" ? { playerId: b.playerId } : typeof b.cricketTeamId === "number" ? { cricketTeamId: b.cricketTeamId } : null;
        if (!target) return NextResponse.json({ error: "Say what you're nominating" }, { status: 400 });
        result = await nominateLot(sessionId, null, target);
        break;
      }
      case "reset":
        result = await resetAuction(leagueId);
        break;
      case "simulate":
        if (!(await isSuperAdmin(request))) return NextResponse.json({ error: "Only the superadmin can simulate an auction" }, { status: 403 });
        result = await simulateAuction(leagueId);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "cricket admin auction POST");
  }
}
