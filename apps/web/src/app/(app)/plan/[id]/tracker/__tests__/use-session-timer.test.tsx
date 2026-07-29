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

/**
 * jsdom in this project's vitest setup does not provide `window.localStorage`,
 * so we install a minimal Map-backed stub to exercise the hook's persistence.
 * Persistence is what fixes #251 (pause/restart surviving navigation), and it
 * must degrade gracefully when storage is unavailable/throws.
 */
function installLocalStorage(
  impl: Pick<Storage, "getItem" | "setItem"> & Partial<Storage>,
): void {
  Object.defineProperty(window, "localStorage", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

function makeMapStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("useSessionTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    installLocalStorage(makeMapStorage());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Tear the stub down between tests.
    delete (window as unknown as { localStorage?: Storage }).localStorage;
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

  // ─── #251: pause / restart must PERSIST across navigation (unmount) ───────

  it("keeps the timer paused and frozen across an unmount/remount with the same sessionId (the reported bug)", () => {
    const sessionId = "sess-persist-pause";
    const first = renderHook(() => useSessionTimer(iso(T0), false, sessionId));

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(first.result.current.elapsed).toBe(10);

    // Pause, then leave the tracker (navigate away → the panel unmounts and the
    // component-local pause refs are destroyed).
    act(() => {
      first.result.current.togglePause();
    });
    expect(first.result.current.paused).toBe(true);
    expect(first.result.current.elapsed).toBe(10);
    first.unmount();

    // 5 minutes pass while the user is on another page.
    act(() => {
      vi.setSystemTime(T0 + 10_000 + 300_000);
    });

    // Return to the tracker (remount, same session): the timer is STILL paused
    // and STILL shows the frozen 10s — NOT the full wall-clock time since start.
    const second = renderHook(() => useSessionTimer(iso(T0), false, sessionId));
    expect(second.result.current.paused).toBe(true);
    expect(second.result.current.elapsed).toBe(10);

    // Resuming continues correctly, excluding the away time.
    act(() => {
      second.result.current.togglePause();
    });
    expect(second.result.current.paused).toBe(false);
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(second.result.current.elapsed).toBe(14);
  });

  it("persists a running timer's completed pause windows across a remount", () => {
    const sessionId = "sess-persist-accum";
    const first = renderHook(() => useSessionTimer(iso(T0), false, sessionId));

    act(() => {
      vi.advanceTimersByTime(10_000); // 10s running
      first.result.current.togglePause(); // pause
    });
    act(() => {
      vi.advanceTimersByTime(30_000); // 30s paused
      first.result.current.togglePause(); // resume → 30s folded into accum
    });
    expect(first.result.current.elapsed).toBe(10);
    first.unmount();

    // Remount after more wall-clock: the 30s paused window stays excluded.
    act(() => {
      vi.setSystemTime(T0 + 40_000 + 5_000);
    });
    const second = renderHook(() => useSessionTimer(iso(T0), false, sessionId));
    expect(second.result.current.paused).toBe(false);
    // now(45s) − start − pausedAccum(30s) = 15s
    expect(second.result.current.elapsed).toBe(15);
  });

  it("restart zeroes the elapsed, clears pause, and the reset persists across a remount", () => {
    const sessionId = "sess-restart";
    const first = renderHook(() => useSessionTimer(iso(T0 - 50_000), false, sessionId));
    expect(first.result.current.elapsed).toBe(50);

    act(() => {
      first.result.current.restart();
    });
    expect(first.result.current.elapsed).toBe(0);
    expect(first.result.current.paused).toBe(false);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(first.result.current.elapsed).toBe(5);
    first.unmount();

    // The restart (startOverride) survives navigation: remount continues from
    // the reset origin, not the original DB startedAt.
    const second = renderHook(() => useSessionTimer(iso(T0 - 50_000), false, sessionId));
    expect(second.result.current.elapsed).toBe(5);
  });

  it("restart while paused clears the pause and both persist", () => {
    const sessionId = "sess-restart-paused";
    const first = renderHook(() => useSessionTimer(iso(T0 - 20_000), false, sessionId));

    act(() => {
      first.result.current.togglePause();
    });
    expect(first.result.current.paused).toBe(true);

    act(() => {
      first.result.current.restart();
    });
    expect(first.result.current.paused).toBe(false);
    expect(first.result.current.elapsed).toBe(0);
    first.unmount();

    const second = renderHook(() => useSessionTimer(iso(T0 - 20_000), false, sessionId));
    expect(second.result.current.paused).toBe(false);
    expect(second.result.current.elapsed).toBe(0);
  });

  it("does not crash and degrades to in-memory when localStorage throws", () => {
    installLocalStorage({
      getItem: () => {
        throw new Error("storage blocked (private mode)");
      },
      setItem: () => {
        throw new Error("storage blocked (private mode)");
      },
    });

    const { result } = renderHook(() => useSessionTimer(iso(T0), false, "sess-throws"));
    expect(result.current.elapsed).toBe(0);

    // Pausing writes to storage — the throw must be swallowed, in-memory pause
    // still works.
    act(() => {
      result.current.togglePause();
    });
    expect(result.current.paused).toBe(true);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.elapsed).toBe(0);

    // Restart also must not crash when storage is unavailable.
    act(() => {
      result.current.restart();
    });
    expect(result.current.paused).toBe(false);
  });

  it("isolates persisted state per sessionId", () => {
    const a = renderHook(() => useSessionTimer(iso(T0), false, "sess-A"));
    act(() => {
      a.result.current.togglePause();
    });
    a.unmount();

    // A different session must NOT inherit session A's paused state.
    const b = renderHook(() => useSessionTimer(iso(T0), false, "sess-B"));
    expect(b.result.current.paused).toBe(false);
  });
});
