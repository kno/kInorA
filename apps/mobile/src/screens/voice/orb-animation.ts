/**
 * Voice-orb animation driver (item-13 follow-up #230).
 *
 * The OD `mobile-voice.html` mockup animates the "Asistente de voz" orb with
 * three concentric pulsing rings and a nine-bar waveform (CSS keyframes). RN has
 * no CSS keyframes, so this module reproduces that motion with the core
 * `Animated` API and exposes it behind a tiny injectable interface so the screen
 * stays purely declarative and the wiring is unit-testable WITHOUT a device.
 *
 * It is PURELY presentational: it owns only `Animated.Value`s and the looping
 * animations that drive them; it never touches capture/transcribe/playback. The
 * screen drives `start()`/`stop()` off the voice status (idle = stopped) and the
 * values feed `Animated.View` transform/opacity styles.
 *
 * `start()`/`stop()` are idempotent and leak-free: `start()` while already
 * running is a no-op, and `stop()` halts every loop and resets each value to its
 * rest pose so no animation loop survives an unmount.
 */
import { Animated, Easing } from "react-native";

/** Concentric pulsing rings behind the orb core (OD: `.ring-1/2/3`). */
export const RING_COUNT = 3;

/** Per-bar base heights (px) of the nine-bar waveform, from the OD mockup. */
export const BAR_HEIGHTS = [14, 24, 36, 48, 36, 52, 28, 40, 20] as const;

// Timings mirror the OD keyframes: rings pulse over 2.4s staggered by 0.6s; the
// waveform bars oscillate ~1.1s staggered so the row ripples rather than pulses
// in unison.
const RING_DURATION_MS = 2400;
const RING_STAGGER_MS = 600;
const BAR_UP_MS = 550;
const BAR_DOWN_MS = 550;
const BAR_STAGGER_MS = 90;

export interface OrbAnimation {
  /** Progress values (0 rest → 1) for the three pulsing rings. */
  readonly rings: readonly Animated.Value[];
  /** Progress values (0 rest → 1) for the nine waveform bars. */
  readonly bars: readonly Animated.Value[];
  /** Start the looping animation. No-op while already running. */
  start(): void;
  /** Stop every loop and reset to the rest pose. Safe when already stopped. */
  stop(): void;
}

/**
 * Build the real `Animated`-backed orb animation. The screen injects a fake in
 * tests, so the default factory only runs on device.
 */
export function createOrbAnimation(): OrbAnimation {
  const rings = Array.from({ length: RING_COUNT }, () => new Animated.Value(0));
  const bars = BAR_HEIGHTS.map(() => new Animated.Value(0));

  // The top-level composites currently running; empty when stopped.
  let running: Animated.CompositeAnimation[] = [];

  const start = () => {
    if (running.length > 0) return; // idempotent: already pulsing

    const ringLoops = rings.map((value, index) =>
      Animated.sequence([
        Animated.delay(index * RING_STAGGER_MS),
        Animated.loop(
          Animated.timing(value, {
            toValue: 1,
            duration: RING_DURATION_MS,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ),
      ]),
    );

    const barLoops = bars.map((value, index) =>
      Animated.sequence([
        Animated.delay(index * BAR_STAGGER_MS),
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, {
              toValue: 1,
              duration: BAR_UP_MS,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(value, {
              toValue: 0,
              duration: BAR_DOWN_MS,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      ]),
    );

    running = [...ringLoops, ...barLoops];
    for (const anim of running) anim.start();
  };

  const stop = () => {
    for (const anim of running) anim.stop();
    running = [];
    for (const value of [...rings, ...bars]) value.setValue(0);
  };

  return { rings, bars, start, stop };
}
