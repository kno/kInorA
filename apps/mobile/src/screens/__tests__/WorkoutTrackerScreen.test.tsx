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

// `Text` children are now `<FormattedMessage>` elements (module-level
// `defineMessages` refactor), not raw strings — `root.findAllByProps({
// children: exactString })` walks the *instance* tree and no longer matches,
// even though the visible text is identical. Assert on the flattened
// *rendered* output instead, which reflects what actually reaches the screen.
function flattenText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => flattenText(child, out));
  } else if (typeof node === "object" && "children" in (node as any)) {
    flattenText((node as any).children, out);
  }
  return out;
}

function renderedText(renderer: ReturnType<typeof create>): string {
  return flattenText(renderer.toJSON()).join("");
}

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
    expect(renderedText(en)).toContain("Loading session…");

    const es = renderScreen("es");
    expect(renderedText(es)).toContain("Cargando sesión…");
  });

  it("bails without crashing when the session request resolves undefined (post-teardown guard)", async () => {
    getWorkoutSession.mockResolvedValue(undefined);
    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    // The `!result` guard prevents reading `result.kind` on undefined — which
    // otherwise surfaced as a post-teardown unhandled rejection under CI load.
    // The screen simply stays in its loading state instead of throwing.
    expect(renderedText(en)).toContain("Loading session…");
  });

  it("renders the active-session state's tracker copy via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({ kind: "ok", session: activeSession });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("Active session");
    expect(enText).toContain("Current exercise");
    expect(enText).toContain("Complete set");
    expect(enText).toContain("Finish session");

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    const esText = renderedText(es);
    expect(esText).toContain("Sesión activa");
    expect(esText).toContain("Ejercicio actual");
    expect(esText).toContain("Completar serie");
    expect(esText).toContain("Finalizar sesión");
  });

  it("renders the session-complete state via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({ kind: "ok", session: completedSession });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("Session completed");
    expect(enText).toContain("Back to home");

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    const esText = renderedText(es);
    expect(esText).toContain("Sesión completada");
    expect(esText).toContain("Volver al inicio");
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
    expect(renderedText(en)).toContain(
      'You already have an active session in "Fuerza" (Day 3). Finish it before starting another.',
    );

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(es)).toContain(
      "Ya tenés una sesión activa en «Fuerza» (Día 3). Terminala antes de empezar otra.",
    );
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
    expect(renderedText(en)).toContain(
      'You already have an active session in "Fuerza". Finish it before starting another.',
    );

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(es)).toContain(
      "Ya tenés una sesión activa en «Fuerza». Terminala antes de empezar otra.",
    );
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
    expect(renderedText(en)).toContain(
      "You already have an active session. Finish it before starting another.",
    );

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(es)).toContain(
      "Ya tenés una sesión activa. Terminala antes de empezar otra.",
    );
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
    expect(renderedText(en)).toContain("We couldn't load the session. Please try again.");

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(es)).toContain("No pudimos cargar la sesión. Intentá de nuevo.");
  });
});
