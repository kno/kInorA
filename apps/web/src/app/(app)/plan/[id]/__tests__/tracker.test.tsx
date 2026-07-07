// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkoutProgram, WorkoutSessionRecord } from "@kinora/contracts";
import { PlanStatusClient } from "../PlanStatusClient";

const usePlanWs = vi.fn();
const getPlanStatusAction = vi.fn();
const regeneratePlanAction = vi.fn();
const startWorkoutSessionAction = vi.fn();
const recordWorkoutSetAction = vi.fn();
const completeWorkoutSessionAction = vi.fn();

vi.mock("@/hooks/use-plan-ws", () => ({
  usePlanWs: (...args: unknown[]) => usePlanWs(...args),
}));

vi.mock("../actions", () => ({
  getPlanStatusAction: (...args: unknown[]) => getPlanStatusAction(...args),
  startWorkoutSessionAction: (...args: unknown[]) => startWorkoutSessionAction(...args),
  recordWorkoutSetAction: (...args: unknown[]) => recordWorkoutSetAction(...args),
  completeWorkoutSessionAction: (...args: unknown[]) => completeWorkoutSessionAction(...args),
}));

vi.mock("@/app/(app)/create-plan/actions", () => ({
  regeneratePlanAction: (...args: unknown[]) => regeneratePlanAction(...args),
}));

const sampleProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Day 1 · Strength",
      exercises: [
        {
          name: "Barbell Squat",
          sets: 4,
          reps: "8",
          restSeconds: 120,
          notes: "Brace before each rep",
        },
      ],
    },
  ],
  limitationWarnings: [],
};

const activeSession: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  exercises: [
    {
      id: "exercise-1",
      workoutSessionId: "session-1",
      exerciseIndex: 0,
      title: "Barbell Squat",
      restSeconds: 120,
      notes: "Brace before each rep",
      setRecords: [
        {
          id: "set-1",
          sessionExerciseId: "exercise-1",
          setIndex: 0,
          targetReps: "8",
          completed: false,
        },
      ],
    },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

function renderClient() {
  usePlanWs.mockReturnValue({ status: "ready" });
  regeneratePlanAction.mockResolvedValue({ planId: "plan-1", status: "generating" });

  return render(
    <PlanStatusClient
      planId="plan-1"
      specId="spec-1"
      initialStatus="ready"
      initialProgram={sampleProgram}
    />,
  );
}

describe("PlanStatusClient tracker flow", () => {
  it("starts or resumes a workout from the ready plan and renders the live tracker", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: activeSession });

    renderClient();

    fireEvent.click(screen.getByRole("button", { name: /start workout/i }));

    await waitFor(() => {
      expect(startWorkoutSessionAction).toHaveBeenCalledWith("plan-1", 1);
    });

    expect(await screen.findByRole("heading", { name: /live workout/i })).toBeTruthy();
    expect(screen.getAllByText(/barbell squat/i)).toHaveLength(2);
    expect(screen.getByText(/next action/i)).toBeTruthy();
    expect(screen.queryByText(/analytics/i)).toBeNull();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it("records sets and completes the workout through server actions", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: activeSession });
    recordWorkoutSetAction.mockResolvedValue({
      ...activeSession,
      exercises: [
        {
          ...activeSession.exercises[0],
          setRecords: [
            {
              ...activeSession.exercises[0]!.setRecords[0]!,
              actualReps: 8,
              weightKg: 80,
              rpe: 8,
              notes: "Strong set",
              completed: true,
            },
          ],
        },
      ],
    });
    completeWorkoutSessionAction.mockResolvedValue({
      ...activeSession,
      status: "completed",
      completedAt: "2026-07-06T10:00:00.000Z",
    });

    renderClient();

    fireEvent.click(screen.getByRole("button", { name: /start workout/i }));
    await screen.findByRole("heading", { name: /live workout/i });

    fireEvent.change(screen.getByLabelText(/actual reps/i), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/weight \(kg\)/i), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText(/^rpe$/i), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "Strong set" } });
    fireEvent.click(screen.getByLabelText(/completed/i));
    fireEvent.click(screen.getByRole("button", { name: /save set/i }));

    await waitFor(() => {
      expect(recordWorkoutSetAction).toHaveBeenCalledWith("session-1", "set-1", {
        actualReps: 8,
        weightKg: 80,
        rpe: 8,
        completed: true,
        notes: "Strong set",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /complete workout/i }));

    await waitFor(() => {
      expect(completeWorkoutSessionAction).toHaveBeenCalledWith("session-1");
    });

    // BLOCKER fix (#93): after a successful complete the tracker is dismissed
    // and the plan view returns (no navigation dead-end). The completed session
    // is persisted server-side; the live tracker must NOT linger.
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /live workout/i })).toBeNull();
    });
    // The ready plan view (its "Start workout" CTA) is shown again.
    expect(screen.getByRole("button", { name: /start workout/i })).toBeTruthy();
  });

  it("renders a conflict notice WITHOUT crashing when start returns a 409 conflict (F1/F3)", async () => {
    // Regression guard: the old code threw on conflict, crashing the page.
    startWorkoutSessionAction.mockResolvedValue({
      kind: "conflict",
      activePlanName: "Summer Cut",
      activeDay: 3,
    });

    renderClient();

    fireEvent.click(screen.getByRole("button", { name: /start workout/i }));

    await waitFor(() => {
      expect(startWorkoutSessionAction).toHaveBeenCalledWith("plan-1", 1);
    });

    // The conflict message is shown; the tracker is NOT rendered; no throw.
    const alert = await screen.findByTestId("start-conflict");
    expect(alert.textContent).toContain("Summer Cut");
    expect(alert.textContent).toContain("Day 3");
    expect(screen.queryByRole("heading", { name: /live workout/i })).toBeNull();
  });

  it("after a conflict, a subsequent successful start clears the banner and shows the tracker (retry)", async () => {
    startWorkoutSessionAction
      .mockResolvedValueOnce({
        kind: "conflict",
        activePlanName: "Summer Cut",
        activeDay: 3,
      })
      .mockResolvedValueOnce({ kind: "ok", session: activeSession });

    renderClient();

    // First start → conflict banner.
    fireEvent.click(screen.getByRole("button", { name: /start workout/i }));
    await screen.findByTestId("start-conflict");

    // Retry (the ready view is still shown) → success clears conflict, swaps view.
    fireEvent.click(screen.getByRole("button", { name: /start workout/i }));

    expect(await screen.findByRole("heading", { name: /live workout/i })).toBeTruthy();
    expect(screen.queryByTestId("start-conflict")).toBeNull();
  });

  it("constrains RPE entry to whole values accepted by the API", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: activeSession });

    renderClient();

    fireEvent.click(screen.getByRole("button", { name: /start workout/i }));
    await screen.findByRole("heading", { name: /live workout/i });

    expect(screen.getByLabelText(/^rpe$/i).getAttribute("step")).toBe("1");
  });
});
