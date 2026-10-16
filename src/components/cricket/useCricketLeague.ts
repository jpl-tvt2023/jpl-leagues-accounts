"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeagueView } from "@/lib/sports/cricket/league";

export type CricketLeaguePayload = LeagueView & { myTeamId: string | null };

/**
 * The league view every cricket page renders from (GET /api/cricket/league). `pollMs` refreshes it
 * in the background (the auction pages use it); `reload()` refetches on demand.
 */
export function useCricketLeague(slug: string, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<CricketLeaguePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cricket/league?league=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? "Couldn't load the league");
        else {
          setError(null);
          setData(body);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the server");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, version]);

  useEffect(() => {
    if (!opts.pollMs) return;
    const id = setInterval(reload, opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, reload]);

  return { data, error, reload };
}
