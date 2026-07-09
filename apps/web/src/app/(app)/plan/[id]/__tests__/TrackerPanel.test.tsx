// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { TrackerPanel } from "../TrackerPanel";

// Scoped CSS module — return class names verbatim (queries are by role/text).
vi.mock("../TrackerPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

function makeSession(): WorkoutSessionRecord {
  return {
    id: "sess-1",
    workoutPlanId: "plan-1",
    status: "active",
    startedAt: "2026-07-08T09:00:00.000Z",
    day: 1,
    exercises: [
      {
        id: "ex-1",
        workoutSessionId: "sess-1",
        exerciseIndex: 0,
        title: "Bench Press",
        restSeconds: 90,
        setRecords: [
          {
            id: "s1a",
            sessionExerciseId: "ex-1",
            setIndex: 0,
            targetReps: "8",
            weightKg: 40,
            actualReps: 8,
            completed: true,
          },
          {
            id: "s1b",
            sessionExerciseId: "ex-1",
            setIndex: 1,
            targetReps: "8",
            weightKg: 40,
            completed: false,
          },
        ],
      },
      {
        id: "ex-2",
        workoutSessionId: "sess-1",
        exerciseIndex: 1,
        title: "Incline Fly",
        restSeconds: 60,
        setRecords: [
          {
            id: "s2a",
            sessionExerciseId: "ex-2",
            setIndex: 0,
            targetReps: "10",
            completed: false,
          },
        ],
      },
    ],
  };
}

/**
 * Multi-set fixture — exercises out an ICU plural "other" (>1) branch for
 * every plural key the tracker renders:
 *  - ex-done  (2/2 sets completed) → timeline.meta.done "other" branch
 *  - ex-active (1/2 sets completed) → the current active exercise
 *  - ex-pending (3 sets, none completed) → the NEXT exercise preview
 *    (next.sets "other") AND timeline.meta.pending "other"
 */
function makeMultiSetSession(): WorkoutSessionRecord {
  return {
    id: "sess-2",
    workoutPlanId: "plan-1",
    status: "active",
    startedAt: "2026-07-08T09:00:00.000Z",
    day: 1,
    exercises: [
      {
        id: "ex-done",
        workoutSessionId: "sess-2",
        exerciseIndex: 0,
        title: "Warm-up Row",
        restSeconds: 60,
        setRecords: [
          {
            id: "d1",
            sessionExerciseId: "ex-done",
            setIndex: 0,
            targetReps: "10",
            actualReps: 10,
            weightKg: 20,
            completed: true,
          },
          {
            id: "d2",
            sessionExerciseId: "ex-done",
            setIndex: 1,
            targetReps: "10",
            actualReps: 10,
            weightKg: 20,
            completed: true,
          },
        ],
      },
      {
        id: "ex-active",
        workoutSessionId: "sess-2",
        exerciseIndex: 1,
        title: "Bench Press",
        restSeconds: 90,
        setRecords: [
          {
            id: "a1",
            sessionExerciseId: "ex-active",
            setIndex: 0,
            targetReps: "8",
            weightKg: 40,
            actualReps: 8,
            completed: true,
          },
          {
            id: "a2",
            sessionExerciseId: "ex-active",
            setIndex: 1,
            targetReps: "8",
            weightKg: 40,
            completed: false,
          },
        ],
      },
      {
        id: "ex-pending",
        workoutSessionId: "sess-2",
        exerciseIndex: 2,
        title: "Incline Fly",
        restSeconds: 60,
        setRecords: [
          {
            id: "p1",
            sessionExerciseId: "ex-pending",
            setIndex: 0,
            targetReps: "10",
            completed: false,
          },
          {
            id: "p2",
            sessionExerciseId: "ex-pending",
            setIndex: 1,
            targetReps: "10",
            completed: false,
          },
          {
            id: "p3",
            sessionExerciseId: "ex-pending",
            setIndex: 2,
            targetReps: "10",
            completed: false,
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

function renderPanel(overrides?: Partial<WorkoutSessionRecord>) {
  const onRecordSet = vi.fn().mockResolvedValue(undefined);
  const onCompleteSession = vi.fn().mockResolvedValue(undefined);
  const session = { ...makeSession(), ...overrides };
  renderWithIntl(
    <TrackerPanel
      session={session}
      onRecordSet={onRecordSet}
      onCompleteSession={onCompleteSession}
    />,
  );
  return { onRecordSet, onCompleteSession };
}

describe("TrackerPanel — redesigned live tracker", () => {
  it("shows the active exercise, its target and real computed progress", () => {
    renderPanel();

    // Topbar heading = current (first-with-incomplete-set) exercise.
    expect(screen.getByRole("heading", { level: 1, name: /bench press/i })).toBeTruthy();
    // 1 of 3 sets completed across the session.
    expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    expect(screen.getByText("33%")).toBeTruthy();
    // Target pill from the active set's targetReps.
    expect(screen.getByText(/Target · 8 reps/i)).toBeTruthy();
  });

  it("steppers change the load and reps values", () => {
    renderPanel();

    // Load seeds from the active set (40 kg); +2.5 step.
    fireEvent.click(screen.getByRole("button", { name: /increase load/i }));
    expect(screen.getByText("42.5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /decrease load/i }));
    fireEvent.click(screen.getByRole("button", { name: /decrease load/i }));
    expect(screen.getByText("37.5")).toBeTruthy();

    // Reps seed from targetReps "8"; +1 step.
    fireEvent.click(screen.getByRole("button", { name: /increase reps/i }));
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("records the current set with the stepper values on Complete set", async () => {
    const { onRecordSet } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /increase load/i })); // 42.5
    fireEvent.change(screen.getByLabelText(/^rpe$/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /complete set/i }));

    await waitFor(() => {
      expect(onRecordSet).toHaveBeenCalledWith(
        "s1b",
        expect.objectContaining({
          completed: true,
          weightKg: 42.5,
          actualReps: 8,
          rpe: 7,
        }),
      );
    });
  });

  it("computes session volume and completed/total sets on the rail", () => {
    renderPanel();

    // Volume = 40 kg × 8 reps (completed set) = 320 kg; other sets have no reps.
    expect(screen.getAllByText(/320 kg/i).length).toBeGreaterThanOrEqual(1);
    // Series = 1 completed of 3 total.
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("renders non-data-backed rail stats as explicit stubs", () => {
    renderPanel();

    expect(screen.getByText("Streak")).toBeTruthy();
    expect(screen.getByText("Avg rest")).toBeTruthy();
    // Two stubbed stats show "—" + a "coming soon" tag.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThanOrEqual(2);
  });

  it("wires Complete workout to onCompleteSession", () => {
    const { onCompleteSession } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /complete workout/i }));
    expect(onCompleteSession).toHaveBeenCalledWith("sess-1");
  });

  it("disables the set controls once the session is completed", () => {
    renderPanel({ status: "completed" });

    expect(
      (screen.getByRole("button", { name: /complete set/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /complete workout/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("renders next.sets and timeline.meta.pending through next-intl's ICU plural — 'one' branch", () => {
    renderPanel();

    // Next exercise (ex-2) has exactly 1 set → the "one" plural branch.
    expect(screen.getByText("1 set")).toBeTruthy();
    // Active exercise (ex-1, 1 of 2 sets done) → "Set 2 of 2 · in progress".
    expect(screen.getByText("Set 2 of 2 · in progress")).toBeTruthy();
    // Pending exercise (ex-2, 1 set) → the "one" plural branch of meta.pending.
    expect(screen.getByText("1 set · pending")).toBeTruthy();
  });

  it("renders next.sets, timeline.meta.done and timeline.meta.pending through the ICU plural 'other' branch", () => {
    const onRecordSet = vi.fn().mockResolvedValue(undefined);
    const onCompleteSession = vi.fn().mockResolvedValue(undefined);
    renderWithIntl(
      <TrackerPanel
        session={makeMultiSetSession()}
        onRecordSet={onRecordSet}
        onCompleteSession={onCompleteSession}
      />,
    );

    // Next exercise (ex-pending) has 3 sets → the "other" plural branch,
    // with `#` substituted — a dropped `#` or wrong branch would render
    // "sets" (no count) or "3 set" (singular), not "3 sets".
    expect(screen.getByText("3 sets")).toBeTruthy();
    // Timeline: ex-done (2/2 completed) → meta.done "other" branch.
    expect(screen.getByText("2 sets · completed")).toBeTruthy();
    // Timeline: ex-pending (3 sets, none done) → meta.pending "other" branch.
    expect(screen.getByText("3 sets · pending")).toBeTruthy();
  });

  it("renders tracker.progress.label and tracker.rest.srActive through next-intl interpolation", () => {
    renderPanel();

    // ICU interpolation, not a `.replace()` fallback — same rendered text.
    expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    // Rest hasn't started yet → both the sr-only status and the visible
    // label read "ready", not "active".
    expect(screen.getAllByText("Ready for the set").length).toBe(2);
  });
});
