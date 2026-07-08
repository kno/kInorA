"use client";

/**
 * useSessionTimer — client-only elapsed-time display seeded from the session's
 * `startedAt`. Pausing freezes the DISPLAY only (the underlying session is not
 * affected); a completed session stops ticking.
 */

import { useEffect, useState } from "react";

export interface SessionTimer {
  elapsed: number;
  paused: boolean;
  togglePause: () => void;
}

function seedElapsed(startedAt: string | undefined): number {
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(startMs)
    ? Math.max(0, Math.floor((Date.now() - startMs) / 1000))
    : 0;
}

export function useSessionTimer(
  startedAt: string | undefined,
  frozen: boolean,
): SessionTimer {
  const [elapsed, setElapsed] = useState(() => seedElapsed(startedAt));
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || frozen) return;
    const id = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(id);
  }, [paused, frozen]);

  return { elapsed, paused, togglePause: () => setPaused((p) => !p) };
}
