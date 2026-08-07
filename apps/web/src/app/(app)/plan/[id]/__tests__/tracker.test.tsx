// @vitest-environment jsdom
/**
 * Tests for PlanStatusClient's tracker + redirect behavior on /plan/[id].
 *
 * A ready plan now redirects to the canonical `/plan` page (PlanWeekView owns
 * the ready rendering AND the workout-start path), so the legacy in-page
 * "start workout" entry is gone. What remains on /plan/[id] is the
 * active-session takeover: if a workout session is already active when this
 * screen mounts, the live TrackerPanel renders and we do NOT redirect (never
 * yank the user out of a live workout).
 *
 * The full start→record→complete lifecycle of the shared `useWorkoutSession`
 * hook is covered on the canonical side (PlanTrackerClient.test.tsx) and in
 * TrackerPanel.test.tsx / use-workout-session.offline.test.ts; here we inject
 * the hook state to cover this component's active-session branch, its
 * TrackerPanel wiring, and the conflict banner.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { PlanStatusClient } from "../PlanStatusClient";

// The redesigned TrackerPanel imports a scoped CSS module; return the class
// names verbatim so component queries stay by role/label/text, not by hash.
vi.mock("../TrackerPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

const usePlanWs = vi.fn();
const regeneratePlanAction = vi.fn();
const routerReplace = vi.fn();

vi.mock("@/hooks/use-plan-ws", () => ({
  usePlanWs: (...args: unknown[]) => usePlanWs(...args),
}));

// PlanStatusClient redirects to the canonical /plan page on ready via
// `router.replace` — mock next/navigation so the App Router hook resolves.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

vi.mock("../actions", () => ({
  getPlanStatusAction: vi.fn(),
}));

vi.mock("@/app/(app)/create-plan/actions", () => ({
  regeneratePlanAction: (...args: unknown[]) => regeneratePlanAction(...args),
}));

// Pass-through mock (real implementation) so each test can `vi.spyOn` the hook
// to inject the active-session / conflict state this component reacts to.
vi.mock("@/app/(app)/plan/use-workout-session", async () => {
  const actual = await vi.importActual<
    typeof import("@/app/(app)/plan/use-workout-session")
  >("@/app/(app)/plan/use-workout-session");
  return { ...actual };
});

import * as useWorkoutSessionModule from "@/app/(app)/plan/use-workout-session";

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
          weightKg: 45,
          completed: false,
        },
      ],
    },
  ],
};

type HookReturn = ReturnType<typeof useWorkoutSessionModule.useWorkoutSession>;

function mockSession(overrides: Partial<HookReturn>) {
  return vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
    activeSession: undefined,
    activeDay: undefined,
    conflict: undefined,
    autoCloseNotice: undefined,
    discardFailed: false,
    error: undefined,
    syncNotice: undefined,
    handleStartWorkout: vi.fn(),
    handleRecordSet: vi.fn().mockResolvedValue(undefined),
    handleCompleteWorkout: vi.fn().mockResolvedValue(undefined),
    handleDiscardSession: vi.fn().mockResolvedValue(undefined),
    handleResumeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as HookReturn);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("PlanStatusClient — active-session takeover on /plan/[id]", () => {
  it("renders the live tracker and does NOT redirect when a session is active", () => {
    usePlanWs.mockReturnValue({ status: "ready" });
    mockSession({ activeSession, activeDay: 1 });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    // The tracker region takes over; a ready plan does NOT redirect while a
    // session is active — that would yank the user out of the live workout.
    expect(screen.getByRole("region", { name: /live workout/i })).toBeTruthy();
    expect(screen.getAllByText(/barbell squat/i).length).toBeGreaterThanOrEqual(1);
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("wires the TrackerPanel record + complete controls to the shared session handlers", async () => {
    usePlanWs.mockReturnValue({ status: "ready" });
    const handleRecordSet = vi.fn().mockResolvedValue(undefined);
    const handleCompleteWorkout = vi.fn().mockResolvedValue(undefined);
    mockSession({ activeSession, activeDay: 1, handleRecordSet, handleCompleteWorkout });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    fireEvent.click(screen.getByRole("button", { name: /complete set/i }));
    await waitFor(() => {
      expect(handleRecordSet).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /complete workout/i }));
    await waitFor(() => {
      expect(handleCompleteWorkout).toHaveBeenCalledWith("session-1");
    });
  });

  it("shows the plan name + active-day identity header above the tracker", () => {
    usePlanWs.mockReturnValue({ status: "ready" });
    mockSession({ activeSession, activeDay: 1 });

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        planName="Summer Cut"
        specId="spec-1"
        initialStatus="ready"
      />,
    );

    const header = screen.getByTestId("tracker-identity");
    expect(header.textContent).toContain("Summer Cut");
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe("PlanStatusClient — conflict banner (non-active branch)", () => {
  it("renders a localized active-session conflict banner and does not redirect while generating", () => {
    usePlanWs.mockReturnValue({ status: "generating" });
    mockSession({
      conflict: {
        activePlanName: "Summer Cut",
        activeDay: 3,
        activeSessionId: "session-blocking",
        activeStartedAt: "2026-08-05T09:00:00.000Z",
      },
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="generating" />,
    );

    const alert = screen.getByTestId("start-conflict");
    expect(alert.textContent).toContain("Summer Cut");
    expect(alert.textContent).toContain("3"); // Day 3
    expect(routerReplace).not.toHaveBeenCalled();
  });
});
