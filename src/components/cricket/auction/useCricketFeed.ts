"use client";

import { useEffect, useState } from "react";
import type { SessionFeed } from "@/lib/sports/cricket/auction/feed";

/**
 * The room's feed (closed lots and missed turns), fetched again whenever `key` changes — the room
 * builds it from the sale count and penalties, so it refetches when a lot closes, not on every bid.
 */
export function useCricketFeed(slug: string, key: string | null): SessionFeed | null {
  const [feed, setFeed] = useState<SessionFeed | null>(null);
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cricket/auction/feed?league=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (res.ok && !cancelled) setFeed(await res.json());
      } catch {
        /* the next change refetches */
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, key]);
  return feed;
}
