"use client";

import { useCallback, useEffect, useState } from "react";

export interface CricketWishlist {
  /** Player ids, highest priority first; null while loading. */
  ids: number[] | null;
  saving: boolean;
  error: string | null;
  has: (playerId: number) => boolean;
  toggle: (playerId: number) => void;
  move: (index: number, by: -1 | 1) => void;
  remove: (playerId: number) => void;
}

/**
 * Your wishlist in the cricket room: if your nomination timer runs out, the first player on it you
 * can still buy is nominated for you. Shared by the Wishlist tab, the lot card's shortlist star and
 * the Nominate list. Saves the whole list on each change.
 */
export function useCricketWishlist(slug: string, enabled: boolean): CricketWishlist {
  const [ids, setIds] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cricket/auction/wishlist?league=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setIds(res.ok && Array.isArray(body.playerIds) ? body.playerIds : []);
        if (!res.ok) setError(body.error ?? "Couldn't load your wishlist");
      } catch {
        if (!cancelled) setError("Couldn't load your wishlist");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, enabled]);

  const save = useCallback(
    async (next: number[]) => {
      setIds(next);
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/cricket/auction/wishlist", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ league: slug, playerIds: next }),
        });
        if (!res.ok) setError("Couldn't save your wishlist");
      } catch {
        setError("Couldn't save your wishlist");
      } finally {
        setSaving(false);
      }
    },
    [slug],
  );

  const list = ids ?? [];
  return {
    ids,
    saving,
    error,
    has: (id) => list.includes(id),
    toggle: (id) => void save(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]),
    move: (i, by) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      void save(next);
    },
    remove: (id) => void save(list.filter((x) => x !== id)),
  };
}
