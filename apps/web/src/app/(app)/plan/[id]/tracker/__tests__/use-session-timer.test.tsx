// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessionTimer } from "../use-session-timer";

/**
 * The session timer must reconcile to WALL-CLOCK time, not count ticks — in a
 * hidden tab `setInterval` is throttled to ~1 tick/min, so a pure +1/sec
 * counter drifts behind real elapsed time. These tests advance a fake clock
 * WITHOUT firing every intermediate tick to prove the displayed value tracks
 * real time regardless of how many ticks actually ran.
 */

const T0 = 1_700_000_000_000; // fixed epoch ms for deterministic runs
const iso = (ms: number) => new Date(ms).toISOString();

describe("useSessionTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds elapsed from startedAt", () => {
    const { result } = renderHook(() => useSessionTimer(iso(T0 - 30_000), false));
    expect(result.current.elapsed).toBe(30);
  });

  it("falls back to 0 when startedAt is missing or invalid", () => {
    const missing = renderHook(() => useSessionTimer(undefined, false));
    expect(missing.result.current.elapsed).toBe(0);

    const invalid = renderHook(() => useSessionTimer("not-a-date", false));
    expect(invalid.result.current.elapsed).toBe(0);
  });

  it("tracks wall-clock across a missed interval (throttled hidden tab)", () => {
    const { result } = renderHook(() => useSessionTimer(iso(T0), false));
    expect(result.current.elapsed).toBe(0);

    // Simulate a backgrounded tab: 65s of real time pass but the throttled
    // interval never fired. Advance ONLY the system clock — no ticks.
    act(() => {
      vi.setSystemTime(T0 + 65_000);
    });
    // Still 0 in state because no reconcile has run yet.
    expect(result.current.elapsed).toBe(0);

    // Tab becomes visible again → reconcile jumps straight to real elapsed,
    // instead of catching up one tick at a time.
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.elapsed).toBe(65);
  });

  it("reconciles on a single tick even after many missed ticks", () => {
    const { result } = renderHook(() => useSessionTimer(iso(T0), false));

    act(() => {
      vi.setSystemTime(T0 + 120_000);
      // Fire just ONE 1s tick (advances the clock to +121s and reconciles).
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.elapsed).toBe(121);
  });

  it("pause freezes the display and resume continues from wall-clock", () => {
    const { result } = renderHook(() => useSessionTimer(iso(T0), false));

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.elapsed).toBe(10);

    // Pause: display must freeze even as real time keeps passing.
    act(() => {
      result.current.togglePause();
    });
    expect(result.current.paused).toBe(true);
    expect(result.current.elapsed).toBe(10);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.elapsed).toBe(10); // frozen through the pause

    // Resume: the 30s paused window is excluded from elapsed.
    act(() => {
      result.current.togglePause();
    });
    expect(result.current.paused).toBe(false);
    expect(result.current.elapsed).toBe(10);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.elapsed).toBe(15); // 10 pre-pause + 5 post-resume
  });

  it("stops advancing when frozen (completed session)", () => {
    const { result } = renderHook(() => useSessionTimer(iso(T0 - 42_000), true));
    expect(result.current.elapsed).toBe(42);

    act(() => {
      vi.setSystemTime(T0 + 60_000);
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // No interval / listener attached while frozen → value stays put.
    expect(result.current.elapsed).toBe(42);
  });
});
