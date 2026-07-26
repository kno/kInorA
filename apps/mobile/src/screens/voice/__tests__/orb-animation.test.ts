import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the voice-orb animation driver (#230).
 *
 * `react-native`'s `Animated` is replaced with a spy double so the looping
 * behaviour is asserted deterministically WITHOUT a device or real timers:
 *   - every `Animated.timing/sequence/loop/delay` returns a tracked composite
 *     whose `start`/`stop` are spies;
 *   - `Animated.Value` records its `setValue` calls.
 * The driver builds exactly one top-level composite per ring + bar and calls
 * `.start()` on each; `.start()` is invoked nowhere else, so the count of
 * started composites is the count of loops the driver owns.
 */
const h = vi.hoisted(() => {
  const composites: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const values: { setValue: ReturnType<typeof vi.fn> }[] = [];
  return { composites, values };
});

vi.mock("react-native", () => {
  class Value {
    setValue = vi.fn();
    constructor() {
      h.values.push(this);
    }
    interpolate() {
      return this;
    }
  }
  const make = () => {
    const composite = { start: vi.fn(), stop: vi.fn() };
    h.composites.push(composite);
    return composite;
  };
  return {
    Animated: {
      Value,
      timing: make,
      sequence: make,
      parallel: make,
      loop: make,
      delay: make,
    },
    Easing: {
      inOut: (fn: unknown) => fn,
      out: (fn: unknown) => fn,
      ease: (n: number) => n,
    },
  };
});

const { createOrbAnimation, RING_COUNT, BAR_HEIGHTS } = await import("../orb-animation");

const TOTAL_LOOPS = RING_COUNT + BAR_HEIGHTS.length; // 3 rings + 9 bars

const startedCount = () => h.composites.filter((c) => c.start.mock.calls.length > 0).length;
const stoppedCount = () => h.composites.filter((c) => c.stop.mock.calls.length > 0).length;

beforeEach(() => {
  h.composites.length = 0;
  h.values.length = 0;
});

describe("createOrbAnimation (#230 orb/waveform driver)", () => {
  it("exposes one animated value per ring and per waveform bar", () => {
    const orb = createOrbAnimation();
    expect(orb.rings).toHaveLength(RING_COUNT);
    expect(orb.bars).toHaveLength(BAR_HEIGHTS.length);
    expect(h.values).toHaveLength(TOTAL_LOOPS);
  });

  it("start() launches exactly one loop per ring and bar", () => {
    const orb = createOrbAnimation();
    orb.start();
    expect(startedCount()).toBe(TOTAL_LOOPS);
  });

  it("start() is idempotent — a second call launches no extra loops", () => {
    const orb = createOrbAnimation();
    orb.start();
    orb.start();
    expect(startedCount()).toBe(TOTAL_LOOPS);
  });

  it("stop() halts every running loop and resets each value to the rest pose", () => {
    const orb = createOrbAnimation();
    orb.start();
    orb.stop();
    expect(stoppedCount()).toBe(TOTAL_LOOPS);
    for (const value of h.values) {
      expect(value.setValue).toHaveBeenCalledWith(0);
    }
  });

  it("stop() before start() is a safe no-op (still resets values, no loop to stop)", () => {
    const orb = createOrbAnimation();
    expect(() => orb.stop()).not.toThrow();
    expect(stoppedCount()).toBe(0);
  });

  it("can restart after a stop (start → stop → start launches loops again)", () => {
    const orb = createOrbAnimation();
    orb.start();
    orb.stop();
    orb.start();
    // Every composite that was ever started stays counted; the point is the
    // second start built and launched a fresh batch (idempotency guard cleared).
    expect(startedCount()).toBe(TOTAL_LOOPS * 2);
  });
});
