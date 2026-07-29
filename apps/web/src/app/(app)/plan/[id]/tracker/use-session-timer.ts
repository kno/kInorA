"use client";

/**
 * useSessionTimer — client-only elapsed-time display seeded from the session's
 * `startedAt`. The displayed elapsed reconciles to WALL-CLOCK time rather than
 * counting `setInterval` ticks, so it stays accurate in backgrounded/hidden
 * tabs and locked phones where the interval is throttled (~1 tick/min). It
 * recomputes on every tick and whenever the tab becomes visible again.
 *
 * Pausing freezes the DISPLAY only (the underlying session is not affected):
 * wall-time spent paused is accumulated and excluded from the elapsed value.
 * A completed session (`frozen`) stops advancing.
 *
 * Pause/restart state is PERSISTED in `localStorage` keyed per session (see
 * `storageKey`), so it survives navigation/unmount and full reload: a paused
 * timer that the user navigates away from returns paused with the away-time
 * excluded, instead of resetting to the raw wall-clock since `startedAt` (the
 * #251 bug). Storage access is best-effort — if it throws or is unavailable
 * (private mode, SSR) the hook silently degrades to the in-memory behaviour.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionTimer {
  elapsed: number;
  paused: boolean;
  togglePause: () => void;
  restart: () => void;
}

/** Persisted per-session timer state. All epoch-ms; `null` = "not set". */
interface PersistedTimerState {
  pausedAccumMs: number;
  pauseStartMs: number | null;
  paused: boolean;
  /** When set, replaces the DB `startMs` — used to implement restart. */
  startOverrideMs: number | null;
}

/** Parse the ISO start into epoch ms, or `NaN` when missing/invalid. */
function parseStartMs(startedAt: string | undefined): number {
  const ms = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

/** Stable localStorage key for a session's timer state. */
function storageKey(sessionId: string): string {
  return `kinora:session-timer:${sessionId}`;
}

/** Best-effort read; returns `null` on any failure (unavailable/blocked). */
function readPersisted(sessionId: string | undefined): PersistedTimerState | null {
  if (!sessionId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTimerState>;
    return {
      pausedAccumMs: Number.isFinite(parsed.pausedAccumMs) ? Number(parsed.pausedAccumMs) : 0,
      pauseStartMs:
        typeof parsed.pauseStartMs === "number" && Number.isFinite(parsed.pauseStartMs)
          ? parsed.pauseStartMs
          : null,
      paused: Boolean(parsed.paused),
      startOverrideMs:
        typeof parsed.startOverrideMs === "number" && Number.isFinite(parsed.startOverrideMs)
          ? parsed.startOverrideMs
          : null,
    };
  } catch {
    return null;
  }
}

/** Best-effort write; swallows any failure so the tracker never crashes. */
function writePersisted(sessionId: string | undefined, state: PersistedTimerState): void {
  if (!sessionId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(state));
  } catch {
    /* storage unavailable/blocked — degrade to in-memory. */
  }
}

export function useSessionTimer(
  startedAt: string | undefined,
  frozen: boolean,
  sessionId?: string,
): SessionTimer {
  const startMsRef = useRef(parseStartMs(startedAt));
  // Wall-time already spent in COMPLETED pause intervals.
  const pausedAccumMsRef = useRef(0);
  // Epoch ms when the current pause began, or `null` while running.
  const pauseStartMsRef = useRef<number | null>(null);
  // Restart origin: when set, used in place of the DB `startMs` so restart can
  // zero the display without mutating the server session.
  const startOverrideMsRef = useRef<number | null>(null);

  // Hydrate persisted state ONCE, synchronously, before the first compute so a
  // returning paused/restarted timer renders with the correct frozen value.
  const hydratedRef = useRef(false);
  if (!hydratedRef.current) {
    hydratedRef.current = true;
    const persisted = readPersisted(sessionId);
    if (persisted) {
      pausedAccumMsRef.current = persisted.pausedAccumMs;
      pauseStartMsRef.current = persisted.pauseStartMs;
      startOverrideMsRef.current = persisted.startOverrideMs;
    }
  }

  const persist = useCallback(() => {
    writePersisted(sessionId, {
      pausedAccumMs: pausedAccumMsRef.current,
      pauseStartMs: pauseStartMsRef.current,
      paused: pauseStartMsRef.current != null,
      startOverrideMs: startOverrideMsRef.current,
    });
  }, [sessionId]);

  // Keep the seed in sync if `startedAt` arrives/changes after mount.
  useEffect(() => {
    startMsRef.current = parseStartMs(startedAt);
  }, [startedAt]);

  // Elapsed = (now − start − pausedTime), floored to whole seconds. While
  // paused the growing "current pause" term cancels the growing `now`, so the
  // value stays frozen. A restart override replaces the DB start. NaN-safe: an
  // invalid start (and no override) yields 0.
  const computeElapsed = useCallback((): number => {
    const startMs = startOverrideMsRef.current ?? startMsRef.current;
    if (!Number.isFinite(startMs)) return 0;
    const now = Date.now();
    const pausedMs =
      pausedAccumMsRef.current +
      (pauseStartMsRef.current != null ? now - pauseStartMsRef.current : 0);
    return Math.max(0, Math.floor((now - startMs - pausedMs) / 1000));
  }, []);

  const [elapsed, setElapsed] = useState(() => computeElapsed());
  const [paused, setPaused] = useState(() => pauseStartMsRef.current != null);

  useEffect(() => {
    if (frozen) return;

    const reconcile = () => setElapsed(computeElapsed());
    reconcile();

    const id = setInterval(reconcile, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [frozen, computeElapsed]);

  const togglePause = useCallback(() => {
    const now = Date.now();
    if (pauseStartMsRef.current != null) {
      // Resuming: fold the just-finished pause into the accumulator.
      pausedAccumMsRef.current += now - pauseStartMsRef.current;
      pauseStartMsRef.current = null;
      setPaused(false);
    } else {
      // Pausing: freeze the display at "now".
      pauseStartMsRef.current = now;
      setPaused(true);
    }
    persist();
    // Reflect the toggle immediately without waiting for the next tick.
    setElapsed(computeElapsed());
  }, [computeElapsed, persist]);

  const restart = useCallback(() => {
    // Record a new start origin (now) and clear all pause bookkeeping — this
    // zeroes the display without touching the server session.
    startOverrideMsRef.current = Date.now();
    pausedAccumMsRef.current = 0;
    pauseStartMsRef.current = null;
    setPaused(false);
    persist();
    setElapsed(computeElapsed());
  }, [computeElapsed, persist]);

  return { elapsed, paused, togglePause, restart };
}
