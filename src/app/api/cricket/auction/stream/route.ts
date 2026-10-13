/**
 * GET /api/cricket/auction/stream?league=<slug>
 *
 * Server-Sent Events for the cricket auction room. Every 2s it advances the session's clock (see
 * `tick` — safe with any number of streams) and sends a `snapshot` event whenever the room's state
 * changed; a `heartbeat` every 15s keeps proxies from closing the connection.
 */

import { NextRequest } from "next/server";
import { buildAuctionSnapshot } from "@/lib/sports/cricket/auction/snapshot";
import { tick } from "@/lib/sports/cricket/auction/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get("league");
  if (!league) return new Response("league is required", { status: 400 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      let last = "";

      const poll = async () => {
        if (closed) return;
        try {
          let snap = await buildAuctionSnapshot(league);
          if (!snap) {
            send("error", { message: "Cricket league not found" });
            closed = true;
            controller.close();
            return;
          }
          if (snap.current?.status === "active") {
            await tick(snap.current.sessionId, "stream");
            snap = (await buildAuctionSnapshot(league)) ?? snap;
          }
          const { serverTime, ...rest } = snap;
          const key = JSON.stringify(rest);
          if (key !== last) {
            last = key;
            send("snapshot", { ...rest, serverTime });
          }
        } catch (err) {
          console.error("[cricket auction stream] poll failed:", err);
        }
      };

      await poll();
      const pollTimer = setInterval(poll, POLL_MS);
      const heartbeat = setInterval(() => send("heartbeat", { serverTime: new Date().toISOString() }), HEARTBEAT_MS);
      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
