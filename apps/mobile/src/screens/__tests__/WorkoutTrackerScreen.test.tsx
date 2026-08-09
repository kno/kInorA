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
  TextInput: (props: any) => <input {...props} />,
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
const abandonSession = vi.fn();
vi.mock("../../api/workout-session.js", () => ({
  getWorkoutSession: (...args: unknown[]) => getWorkoutSession(...args),
  startWorkoutSession: (...args: unknown[]) => startWorkoutSession(...args),
  recordWorkoutSet: (...args: unknown[]) => recordWorkoutSet(...args),
  completeWorkoutSession: (...args: unknown[]) => completeWorkoutSession(...args),
  abandonSession: (...args: unknown[]) => abandonSession(...args),
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

  const conflictStartedAt = "2026-08-05T09:00:00.000Z";

  it("renders the active-session conflict state via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza",
      activeDay: 3,
      activeSessionId: "sess-blocking",
      activeStartedAt: conflictStartedAt,
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain('You already have an active session in "Fuerza" (Day 3)');
    expect(enText).toContain("Finish it before starting another.");
    // ICU {date, date, medium} — the blocking session's start date.
    expect(enText).toContain("Aug 5, 2026");

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    const esText = renderedText(es);
    expect(esText).toContain("Ya tienes una sesión activa en «Fuerza» (Día 3)");
    expect(esText).toContain("Termínala antes de empezar otra.");
    expect(esText).toContain("2026");
  });

  it("renders the conflict-with-plan-only branch (no day) via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza",
      activeDay: undefined,
      activeSessionId: "sess-blocking",
      activeStartedAt: conflictStartedAt,
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain('You already have an active session in "Fuerza"');
    expect(enText).toContain("Finish it before starting another.");
    expect(enText).toContain("Aug 5, 2026");

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    const esText = renderedText(es);
    expect(esText).toContain("Ya tienes una sesión activa en «Fuerza»");
    expect(esText).toContain("Termínala antes de empezar otra.");
  });

  it("renders the generic conflict branch (no plan name) via useIntl(), in EN and ES", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: undefined,
      activeDay: undefined,
      activeSessionId: "sess-blocking",
      activeStartedAt: conflictStartedAt,
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("You already have an active session");
    expect(enText).toContain("Finish it before starting another.");
    expect(enText).toContain("Aug 5, 2026");

    const es = renderScreen("es");
    await act(async () => {
      await Promise.resolve();
    });
    const esText = renderedText(es);
    expect(esText).toContain("Ya tienes una sesión activa");
    expect(esText).toContain("Termínala antes de empezar otra.");
  });

  it("offers Resume and Discard actions in the conflict state", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza",
      activeDay: 3,
      activeSessionId: "sess-blocking",
      activeStartedAt: conflictStartedAt,
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("Resume");
    expect(enText).toContain("Discard");
  });

  it("Discard requires one confirmation, then calls abandonSession", async () => {
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza",
      activeDay: 3,
      activeSessionId: "sess-blocking",
      activeStartedAt: conflictStartedAt,
    });
    abandonSession.mockResolvedValue({
      kind: "ok",
      session: { ...activeSession, status: "abandoned" },
    });

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });

    const discardBtn = en.root.findByProps({ testID: "conflict-discard" });
    act(() => {
      discardBtn.props.onPress();
    });

    const confirmBtn = en.root.findByProps({ testID: "conflict-discard-confirm" });
    await act(async () => {
      confirmBtn.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(abandonSession).toHaveBeenCalledWith("sess-blocking");
  });

  it("disables the discard confirm control while abandonSession is in flight, and does not double-fire on a repeated tap", async () => {
    abandonSession.mockClear();
    getWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "active_session_conflict",
      activePlanName: "Fuerza",
      activeDay: 3,
      activeSessionId: "sess-blocking",
      activeStartedAt: conflictStartedAt,
    });
    let resolveAbandon!: (value: { kind: "ok"; session: WorkoutSessionRecord }) => void;
    abandonSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAbandon = resolve;
        }),
    );

    const en = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });

    const discardBtn = en.root.findByProps({ testID: "conflict-discard" });
    act(() => {
      discardBtn.props.onPress();
    });

    const confirmBtn = en.root.findByProps({ testID: "conflict-discard-confirm" });
    act(() => {
      // Two synchronous taps, as a slow connection lets a user do before any
      // re-render lands: the in-flight ref guard (set eagerly, before the
      // first `await`) must block the second call.
      confirmBtn.props.onPress();
      confirmBtn.props.onPress();
    });

    // The abandon call is now in flight — the Discard control (re-rendered
    // as "conflict-discard", since confirming flips back to false) must be
    // disabled while it resolves.
    const discardAfterConfirm = en.root.findByProps({ testID: "conflict-discard" });
    expect(discardAfterConfirm.props.disabled).toBe(true);

    await act(async () => {
      resolveAbandon({ kind: "ok", session: { ...activeSession, status: "abandoned" } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(abandonSession).toHaveBeenCalledTimes(1);
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
    expect(renderedText(es)).toContain("No pudimos cargar la sesión. Inténtalo de nuevo.");
  });

  // 17d PR C: PR B's `409 plan_archived` reaches this client as a plain
  // `message: "plan_archived"`. Left in the generic branch it rendered
  // "We couldn't start the session. Please try again." next to a Retry —
  // a retry that can never succeed, because the refusal is a state the user
  // has to change on the plans list, not a transient failure.
  it("explains a refused start on an archived plan, in EN and ES, and offers no futile retry", async () => {
    startWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "plan_archived",
      code: "VALIDATION",
    });

    const en = renderScreen("en", { planId: "p1", day: 1 });
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("This plan is archived");
    expect(enText).toContain("Unarchive it from your plans list");
    expect(enText).not.toContain("We couldn't start the session. Please try again.");
    expect(enText).not.toContain("Retry");

    const es = renderScreen("es", { planId: "p1", day: 1 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(es)).toContain("Este plan está archivado");
  });

  // kno/kInorA#409: the web plan editor can remove a day, which makes the
  // API's `404 day_not_in_plan` reachable through a user action. Left in the
  // generic branch it rendered "We couldn't start the session. Please try
  // again." next to a Retry that can never succeed, and dropped the
  // `availableDays` the API sends precisely so the screen can say more.
  it("names the days that remain when the requested day was removed, in EN and ES", async () => {
    startWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "day_not_in_plan",
      availableDays: [1, 2, 4],
      code: "NOT_FOUND",
    });

    const en = renderScreen("en", { planId: "p1", day: 3 });
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("Day 3 is no longer part of this plan");
    expect(enText).toMatch(/you can train days 1, 2,? and 4/);
    expect(enText).not.toContain("We couldn't start the session. Please try again.");

    const es = renderScreen("es", { planId: "p1", day: 3 });
    await act(async () => {
      await Promise.resolve();
    });
    const esText = renderedText(es);
    expect(esText).toContain("El día 3 ya no forma parte de este plan");
    expect(esText).toContain("puedes entrenar los días 1, 2 y 4");
  });

  // The affordance, not only the copy: a Retry here re-sends the exact same
  // start and gets the exact same refusal, forever.
  it("offers no retry control for a removed day, only a way back to the plan", async () => {
    startWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "day_not_in_plan",
      availableDays: [1, 2, 4],
      code: "NOT_FOUND",
    });

    const en = renderScreen("en", { planId: "p1", day: 3 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(en.root.findAllByProps({ testID: "tracker-retry" })).toHaveLength(0);
    expect(renderedText(en)).not.toContain("Retry");

    const back = en.root.findByProps({ testID: "day-not-in-plan-back" });
    navigation.goBack.mockClear();
    act(() => {
      back.props.onPress();
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when the plan has no days left at all", async () => {
    startWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "day_not_in_plan",
      availableDays: [],
      code: "NOT_FOUND",
    });

    const en = renderScreen("en", { planId: "p1", day: 3 });
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("no days are left to train");
    expect(enText).not.toContain("you can train");
    expect(en.root.findAllByProps({ testID: "tracker-retry" })).toHaveLength(0);

    const es = renderScreen("es", { planId: "p1", day: 3 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(es)).toContain("no queda ningún día para entrenar");
  });

  it("uses the singular when exactly one day remains", async () => {
    startWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "day_not_in_plan",
      availableDays: [2],
      code: "NOT_FOUND",
    });

    const en = renderScreen("en", { planId: "p1", day: 3 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(en)).toContain("you can train day 2");

    const es = renderScreen("es", { planId: "p1", day: 3 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(renderedText(es)).toContain("puedes entrenar el día 2");
  });

  it("still offers a retry for a genuinely transient start failure", async () => {
    startWorkoutSession.mockResolvedValue({
      kind: "error",
      message: "workout_session_request_failed",
      code: "UNREACHABLE",
    });

    const en = renderScreen("en", { planId: "p1", day: 1 });
    await act(async () => {
      await Promise.resolve();
    });
    const enText = renderedText(en);
    expect(enText).toContain("We couldn't start the session. Please try again.");
    expect(enText).toContain("Retry");
  });
});

// 14b-v1.1 Slice B: mobile RPE capture — the set-record submit must carry the
// entered `rpe`, and must omit it (stay optional) when none was entered.
describe("WorkoutTrackerScreen — mobile RPE capture parity (14b-v1.1 Slice B)", () => {
  function findByAccessibilityLabelPrefix(
    renderer: ReturnType<typeof create>,
    prefix: string,
  ) {
    return renderer.root.find(
      (n) =>
        typeof n.props.accessibilityLabel === "string" &&
        n.props.accessibilityLabel.startsWith(prefix),
    );
  }

  it("includes the entered rpe in the recordWorkoutSet payload", async () => {
    recordWorkoutSet.mockClear();
    getWorkoutSession.mockResolvedValue({ kind: "ok", session: activeSession });
    recordWorkoutSet.mockResolvedValue({ kind: "ok", session: activeSession });

    const renderer = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });

    const rpeInput = renderer.root.find(
      (n) => n.props.accessibilityLabel === "RPE, optional, 0 to 10",
    );
    act(() => {
      rpeInput.props.onChangeText("8");
    });

    const completeButton = findByAccessibilityLabelPrefix(renderer, "Complete set");
    await act(async () => {
      await completeButton.props.onPress();
    });

    expect(recordWorkoutSet).toHaveBeenCalledTimes(1);
    expect(recordWorkoutSet.mock.calls[0]?.[2]).toMatchObject({ rpe: 8 });
  });

  it("omits rpe from the payload when none was entered (stays optional)", async () => {
    recordWorkoutSet.mockClear();
    getWorkoutSession.mockResolvedValue({ kind: "ok", session: activeSession });
    recordWorkoutSet.mockResolvedValue({ kind: "ok", session: activeSession });

    const renderer = renderScreen("en");
    await act(async () => {
      await Promise.resolve();
    });

    const completeButton = findByAccessibilityLabelPrefix(renderer, "Complete set");
    await act(async () => {
      await completeButton.props.onPress();
    });

    expect(recordWorkoutSet).toHaveBeenCalledTimes(1);
    expect(recordWorkoutSet.mock.calls[0]?.[2]).not.toHaveProperty("rpe");
  });
});
