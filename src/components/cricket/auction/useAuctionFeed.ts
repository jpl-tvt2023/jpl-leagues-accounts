"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuctionSnapshot } from "@/lib/sports/cricket/auction/snapshot";

export type RoomState = AuctionSnapshot & { myTeamId: string | null };

/**
 * The auction room's live state: the SSE stream's snapshots, falling back to polling the state
 * endpoint if the stream drops. `now()` is server time (corrected for this device's clock), so
 * every countdown agrees with the server's deadlines.
 */
export function useAuctionFeed(slug: string) {
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const myTeam = useRef<string | null>(null);
  const offset = useRef(0);

  const absorb = useCallback((snap: AuctionSnapshot & { myTeamId?: string | null }) => {
    offset.current = new Date(snap.serverTime).getTime() - Date.now();
    if (snap.myTeamId !== undefined) myTeam.current = snap.myTeamId;
    setState({ ...snap, myTeamId: myTeam.current });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/cricket/auction/state?league=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? "Couldn't load the auction");
      else {
        setError(null);
        absorb(body);
      }
    } catch {
      setError("Couldn't reach the server");
    }
  }, [slug, absorb]);

  useEffect(() => {
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    const startPolling = () => {
      if (!poll) poll = setInterval(refresh, 3000);
    };
    // The first state read also learns myTeamId, which the stream doesn't carry.
    const initial = setTimeout(refresh, 0);
    try {
      source = new EventSource(`/api/cricket/auction/stream?league=${encodeURIComponent(slug)}`);
      source.addEventListener("snapshot", (e) => {
        setConnected(true);
        absorb(JSON.parse((e as MessageEvent).data));
      });
      source.addEventListener("heartbeat", (e) => {
        offset.current = new Date(JSON.parse((e as MessageEvent).data).serverTime).getTime() - Date.now();
      });
      source.onerror = () => {
        setConnected(false);
        if (!closed) startPolling();
      };
      source.onopen = () => {
        setConnected(true);
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
      };
    } catch {
      startPolling();
    }
    return () => {
      closed = true;
      clearTimeout(initial);
      source?.close();
      if (poll) clearInterval(poll);
    };
  }, [slug, refresh, absorb]);

  const now = useCallback(() => Date.now() + offset.current, []);
  return { state, error, connected, refresh, now };
}

/** Re-render every `ms` (for countdowns). */
export function useTicker(ms = 250): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
