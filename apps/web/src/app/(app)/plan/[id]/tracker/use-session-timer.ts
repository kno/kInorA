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
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface SessionTimer {
  elapsed: number;
  paused: boolean;
  togglePause: () => void;
}

/** Parse the ISO start into epoch ms, or `NaN` when missing/invalid. */
function parseStartMs(startedAt: string | undefined): number {
  const ms = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

export function useSessionTimer(
  startedAt: string | undefined,
  frozen: boolean,
): SessionTimer {
  const startMsRef = useRef(parseStartMs(startedAt));
  // Wall-time already spent in COMPLETED pause intervals.
  const pausedAccumMsRef = useRef(0);
  // Epoch ms when the current pause began, or `null` while running.
  const pauseStartMsRef = useRef<number | null>(null);

  // Keep the seed in sync if `startedAt` arrives/changes after mount.
  useEffect(() => {
    startMsRef.current = parseStartMs(startedAt);
  }, [startedAt]);

  // Elapsed = (now − start − pausedTime), floored to whole seconds. While
  // paused the growing "current pause" term cancels the growing `now`, so the
  // value stays frozen. NaN-safe: an invalid start yields 0.
  const computeElapsed = useCallback((): number => {
    const startMs = startMsRef.current;
    if (!Number.isFinite(startMs)) return 0;
    const now = Date.now();
    const pausedMs =
      pausedAccumMsRef.current +
      (pauseStartMsRef.current != null ? now - pauseStartMsRef.current : 0);
    return Math.max(0, Math.floor((now - startMs - pausedMs) / 1000));
  }, []);

  const [elapsed, setElapsed] = useState(() => computeElapsed());
  const [paused, setPaused] = useState(false);

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
    // Reflect the toggle immediately without waiting for the next tick.
    setElapsed(computeElapsed());
  }, [computeElapsed]);

  return { elapsed, paused, togglePause };
}
