/**
 * Slice 10, Phase 10.1.2/10.1.3 — proves `WorkoutTrackerScreen` (and its
 * tracker/ children) renders through `useIntl()`/`react-intl`, not the old
 * hardcoded `trackerCopy` constants, in both locales.
 *
 * Follows the same mocking convention as `HomeScreen.test.tsx`: `react-native`
 * and `@react-navigation/native-stack` use Flow's `import typeof` syntax
 * Vite/Rollup cannot parse under Vitest (no Metro/jest-expo Babel transform
 * here), so host primitives are stubbed with passthrough elements while the
 * REAL component tree (including its `useIntl()` calls) renders and is
 * asserted on.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import type {
  SessionExerciseRecord,
  SetRecordDTO,
  WorkoutSessionRecord,
} from "@kinora/contracts";
import { resolveMessages } from "../../i18n/locale.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: "ScrollView",
  Pressable: ({ children, ...rest }: any) => (
    <button type="button" {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  StyleSheet: { create: (styles: unknown) => styles },
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));

vi.mock("react-native-svg", () => ({
  default: "Svg",
  Svg: "Svg",
  Circle: "Circle",
  G: "G",
  Line: "Line",
  Path: "Path",
  Polygon: "Polygon",
  Polyline: "Polyline",
  Rect: "Rect",
}));

vi.mock("../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(),
}));

const getWorkoutSession = vi.fn();
const startWorkoutSession = vi.fn();
const recordWorkoutSet = vi.fn();
const completeWorkoutSession = vi.fn();
vi.mock("../../api/workout-session.js", () => ({
  getWorkoutSession: (...args: unknown[]) => getWorkoutSession(...args),
  startWorkoutSession: (...args: unknown[]) => startWorkoutSession(...args),
  recordWorkoutSet: (...args: unknown[]) => recordWorkoutSet(...args),
  completeWorkoutSession: (...args: unknown[]) => completeWorkoutSession(...args),
}));

const WorkoutTrackerScreen = (await import("../WorkoutTrackerScreen.js")).default;

const navigation = { goBack: vi.fn(), reset: vi.fn() } as any;

function set(overrides: Partial<SetRecordDTO> & { id: string }): SetRecordDTO {
  return { sessionExerciseId: "ex1", setIndex: 0, targetReps: "8", completed: false, ...overrides };
}

function exercise(
  overrides: Partial<SessionExerciseRecord> & { id: string },
): SessionExerciseRecord {
  return {
    workoutSessionId: "s1",
    exerciseIndex: 0,
    title: "Sentadilla",
    restSeconds: 90,
    setRecords: [],
    ...overrides,
  };
}

const activeSession: WorkoutSessionRecord = {
  id: "s1",
  workoutPlanId: "p1",
  status: "active",
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  exercises: [
    exercise({
      id: "ex1",
      setRecords: [
        set({ id: "set1", weightKg: 40, completed: true }),
        set({ id: "set2", weightKg: 40 }),
      ],
    }),
    exercise({
      id: "ex2",
      exerciseIndex: 1,
      title: "Press banca",
      setRecords: [set({ id: "set3", sessionExerciseId: "ex2", weightKg: 30, targetReps: "10" })],
    }),
  ],
};

const completedSession: WorkoutSessionRecord = {
  ...activeSession,
  status: "completed",
  exercises: activeSession.exercises.map((ex) => ({
    ...ex,
    setRecords: ex.setRecords.map((s) => ({ ...s, completed: true })),
  })),
};

function renderScreen(locale: "en" | "es", routeParams: Record<string, unknown> = { sessionId: "s1" }) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <IntlProvider locale={locale} defaultLocale="en" messages={resolveMessages(locale)}>
        <WorkoutTrackerScreen
          navigation={navigation}
          route={{ key: "Tracker", name: "Tracker", params: routeParams } as any}
        />
      </IntlProvider>,
    );
  });
  return renderer;
}

describe("WorkoutTrackerScreen (migrated off trackerCopy — 10.1.2/10.1.3)", () => {
  it("renders the loading state via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockReturnValue(new Promise(() => {})); // never resolves
    const en = renderScreen("en");
    expect(en.root.findAllByProps({ children: "Loading session…" }).length).toBeGreaterThan(0);

    const es = renderScreen("es");
    expect(es.root.findAllByProps({ children: "Cargando sesión…" }).length).toBeGreaterThan(0);
  });

  it("renders the active-session state's tracker copy via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({ kind: "ok", session: activeSession });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    expect(en.root.findAllByProps({ children: "Active session" }).length).toBeGreaterThan(0);
    expect(en.root.findAllByProps({ children: "Current exercise" }).length).toBeGreaterThan(0);
    expect(en.root.findAllByProps({ children: "Complete set" }).length).toBeGreaterThan(0);
    expect(en.root.findAllByProps({ children: "Finish session" }).length).toBeGreaterThan(0);

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(es.root.findAllByProps({ children: "Sesión activa" }).length).toBeGreaterThan(0);
    expect(es.root.findAllByProps({ children: "Ejercicio actual" }).length).toBeGreaterThan(0);
    expect(es.root.findAllByProps({ children: "Completar serie" }).length).toBeGreaterThan(0);
    expect(es.root.findAllByProps({ children: "Finalizar sesión" }).length).toBeGreaterThan(0);
  });

  it("renders the session-complete state via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({ kind: "ok", session: completedSession });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    expect(en.root.findAllByProps({ children: "Session completed" }).length).toBeGreaterThan(0);
    expect(en.root.findAllByProps({ children: "Back to home" }).length).toBeGreaterThan(0);

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(es.root.findAllByProps({ children: "Sesión completada" }).length).toBeGreaterThan(0);
    expect(es.root.findAllByProps({ children: "Volver al inicio" }).length).toBeGreaterThan(0);
  });

  it("renders the active-session conflict state via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza",
      activeDay: 3,
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      en.root.findAllByProps({
        children: 'You already have an active session in "Fuerza" (Day 3). Finish it before starting another.',
      }).length,
    ).toBeGreaterThan(0);

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      es.root.findAllByProps({
        children: "Ya tenés una sesión activa en «Fuerza» (Día 3). Terminala antes de empezar otra.",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("renders the conflict-with-plan-only branch (no day) via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza",
      activeDay: undefined,
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      en.root.findAllByProps({
        children:
          'You already have an active session in "Fuerza". Finish it before starting another.',
      }).length,
    ).toBeGreaterThan(0);

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      es.root.findAllByProps({
        children: "Ya tenés una sesión activa en «Fuerza». Terminala antes de empezar otra.",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("renders the generic conflict branch (no plan name) via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: undefined,
      activeDay: undefined,
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      en.root.findAllByProps({
        children: "You already have an active session. Finish it before starting another.",
      }).length,
    ).toBeGreaterThan(0);

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      es.root.findAllByProps({
        children: "Ya tenés una sesión activa. Terminala antes de empezar otra.",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("renders the errorLoad state via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "workout_session_request_failed",
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      en.root.findAllByProps({
        children: "We couldn't load the session. Please try again.",
      }).length,
    ).toBeGreaterThan(0);

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      es.root.findAllByProps({
        children: "No pudimos cargar la sesión. Intentá de nuevo.",
      }).length,
    ).toBeGreaterThan(0);
  });
});
