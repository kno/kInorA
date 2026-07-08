"use client";

/**
 * useRestTimer — client-only rest countdown seeded from the active exercise's
 * `restSeconds`. `start()` (re)begins the countdown, `skip()` clears it, and
 * `addTime()` extends the current rest by 15s. `remaining` is `null` while idle.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface RestTimer {
  /** Seconds left, or `null` while idle. */
  remaining: number | null;
  active: boolean;
  start: () => void;
  skip: () => void;
  addTime: () => void;
}

export function useRestTimer(duration: number): RestTimer {
  const [remaining, setRemaining] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    setRemaining(duration);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev == null) return prev;
        if (prev <= 1) {
          stop();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, [duration, stop]);

  const skip = useCallback(() => {
    stop();
    setRemaining(null);
  }, [stop]);

  const addTime = useCallback(() => {
    setRemaining((prev) => (prev == null ? prev : Math.min(prev + 15, 599)));
  }, []);

  // Clear the interval on unmount.
  useEffect(() => stop, [stop]);

  return { remaining, active: remaining != null, start, skip, addTime };
}
