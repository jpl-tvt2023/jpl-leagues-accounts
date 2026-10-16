"use client";

/**
 * Turn and outbid alerts for an auction room (FPL and cricket): a short chime, a buzz on phones for
 * your turn, and a flashing tab title while the room isn't in view. No permissions are asked for —
 * browsers only play sound after the first tap or key press on the page, and the title only flashes
 * while the tab is hidden or unfocused. Muting is remembered on this device.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { alertStillApplies, alertTitle, detectAlerts, titleFrame, type AlertKind, type AlertSignal } from "@/lib/auction/alerts";

const STORAGE_KEY = "jpl:auction-alerts";
const FLASH_EVERY_MS = 1000;
const FLASH_FOR_MS = 60_000;

// ─── Sound ──────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;

/** The page's one AudioContext, created and resumed from a user gesture. */
function resumeAudio(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

/** Turn: a rising two-note chime. Outbid: a falling pair. Silent until audio is unlocked. */
function playChime(kind: AlertKind): void {
  const ac = audioCtx;
  if (!ac || ac.state !== "running") return;
  const notes = kind === "turn" ? [660, 880] : [880, 520];
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const t = ac.currentTime + i * 0.18;
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  });
}

// ─── Tab title ──────────────────────────────────────────────────────────────

interface Flash {
  timer: ReturnType<typeof setInterval> | null;
  base: string;
  kind: AlertKind | null;
  lot: string | null;
}

function stopFlash(f: Flash): void {
  if (f.timer) {
    clearInterval(f.timer);
    document.title = f.base;
  }
  f.timer = null;
  f.kind = null;
}

function startFlash(f: Flash, kind: AlertKind, lot: string | null, message: string): void {
  if (typeof document === "undefined") return;
  if (!document.hidden && document.hasFocus()) return; // they're looking at the room
  stopFlash(f);
  f.base = document.title;
  f.kind = kind;
  f.lot = lot;
  const started = Date.now();
  let tick = 1;
  document.title = message;
  f.timer = setInterval(() => {
    if (Date.now() - started > FLASH_FOR_MS) stopFlash(f);
    else document.title = titleFrame(f.base, message, tick++);
  }, FLASH_EVERY_MS);
}

// ─── Mute preference (localStorage, shared by every room on the page) ────────

const muteListeners = new Set<() => void>();
/** Used when storage is blocked, so the switch still works for this visit. */
let mutedInMemory = false;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    return mutedInMemory;
  }
}

function writeMuted(muted: boolean): void {
  mutedInMemory = muted;
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? "off" : "on");
  } catch {
    /* kept in memory only */
  }
  muteListeners.forEach((l) => l());
}

function subscribeMuted(listener: () => void): () => void {
  muteListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    muteListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface AuctionAlerts {
  muted: boolean;
  toggleMuted: () => void;
  /** The latest alert raised (for in-room banners), with the lot it was raised on. */
  lastAlert: { kind: AlertKind; lot: string | null; id: number } | null;
}

/** Watch the room's signal; alert on your turn and when you're outbid. `enabled: false` for spectators. */
export function useAuctionAlerts(signal: AlertSignal, opts: { enabled?: boolean } = {}): AuctionAlerts {
  const enabled = opts.enabled ?? true;
  // On by default; the saved choice applies once mounted (there's no storage on the server).
  const muted = useSyncExternalStore(subscribeMuted, readMuted, () => false);
  const [lastAlert, setLastAlert] = useState<AuctionAlerts["lastAlert"]>(null);
  const prev = useRef<AlertSignal | null>(null);
  const flash = useRef<Flash>({ timer: null, base: "", kind: null, lot: null });

  // Browsers allow sound only after a gesture: unlock on the first one. Stop flashing on return.
  useEffect(() => {
    const unlock = () => resumeAudio();
    const back = () => {
      if (!document.hidden && document.hasFocus()) stopFlash(flash.current);
    };
    const f = flash.current;
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
      stopFlash(f);
    };
  }, []);

  const { myTurn, lotKey, leaderIsMe, lotName } = signal;
  useEffect(() => {
    if (!enabled) {
      prev.current = null;
      return;
    }
    const next: AlertSignal = { myTurn, lotKey, leaderIsMe, lotName };
    const kinds = detectAlerts(prev.current, next);
    prev.current = next;
    const f = flash.current;
    if (f.kind && !alertStillApplies(f.kind, f.lot, next)) stopFlash(f);
    const kind = kinds[0];
    if (!kind) return;
    setLastAlert({ kind, lot: lotKey, id: Date.now() });
    if (!muted) {
      playChime(kind);
      if (kind === "turn") navigator.vibrate?.([120, 60, 120]);
    }
    startFlash(f, kind, lotKey, alertTitle(kind, lotName));
  }, [enabled, myTurn, lotKey, leaderIsMe, lotName, muted]);

  const toggleMuted = useCallback(() => {
    const next = !muted;
    writeMuted(next);
    if (!next) {
      // Turning alerts on is a gesture: unlock audio and play a sample.
      resumeAudio();
      setTimeout(() => playChime("turn"), 50);
    }
  }, [muted]);

  return { muted, toggleMuted, lastAlert };
}
