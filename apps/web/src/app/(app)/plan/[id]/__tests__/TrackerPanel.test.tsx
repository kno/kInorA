// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkoutSessionRecord } from "@kinora/contracts";
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

afterEach(() => {
  vi.clearAllMocks();
});

function renderPanel(overrides?: Partial<WorkoutSessionRecord>) {
  const onRecordSet = vi.fn().mockResolvedValue(undefined);
  const onCompleteSession = vi.fn().mockResolvedValue(undefined);
  const session = { ...makeSession(), ...overrides };
  render(
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
});
