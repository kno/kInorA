// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { WorkoutProgram, WorkoutSessionRecord } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";

// Mock the CSS modules to avoid transform errors.
vi.mock("../plan-week-view.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock("../[id]/TrackerPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

// Mock the server actions imported by PlanTrackerClient. These are the SAME
// actions used by the `/plan/[id]` flow — PlanTrackerClient reuses them, it
// does not define a new API boundary (#85 compliance).
const startWorkoutSessionAction = vi.fn();
const recordWorkoutSetAction = vi.fn();
const completeWorkoutSessionAction = vi.fn();

vi.mock("../[id]/actions", () => ({
  startWorkoutSessionAction: (...args: unknown[]) => startWorkoutSessionAction(...args),
  recordWorkoutSetAction: (...args: unknown[]) => recordWorkoutSetAction(...args),
  completeWorkoutSessionAction: (...args: unknown[]) => completeWorkoutSessionAction(...args),
}));

// Pass-through mock (real implementation) so a single test below can
// `vi.spyOn` the hook's return value to inject an error code the REAL hook
// never produces (an unmapped/unknown code) — every other test in this file
// exercises the real hook via the mocked actions above, unaffected by this.
vi.mock("../use-workout-session", async () => {
  const actual = await vi.importActual<typeof import("../use-workout-session")>(
    "../use-workout-session",
  );
  return { ...actual };
});

import { PlanTrackerClient } from "../PlanTrackerClient";
import * as useWorkoutSessionModule from "../use-workout-session";

afterEach(() => {
  vi.clearAllMocks();
});

const program: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Push Day",
      exercises: [
        { name: "Bench Press", sets: 4, reps: "8-10", restSeconds: 90 },
      ],
    },
    {
      day: 2,
      title: "Pull Day",
      exercises: [
        { name: "Barbell Row", sets: 4, reps: "8", restSeconds: 90 },
      ],
    },
  ],
  limitationWarnings: [],
} as unknown as WorkoutProgram;

const fakeSession: WorkoutSessionRecord = {
  id: "sess-1",
  status: "active",
  day: 1,
  exercises: [
    {
      id: "ex-1",
      title: "Bench Press",
      restSeconds: 90,
      notes: undefined,
      setRecords: [
        {
          id: "set-1",
          setIndex: 0,
          targetReps: 10,
          actualReps: undefined,
          weightKg: undefined,
          rpe: undefined,
          completed: false,
          notes: undefined,
        },
      ],
    },
  ],
} as unknown as WorkoutSessionRecord;

describe("PlanTrackerClient — inline state swap (#93 Slice 3)", () => {
  beforeEach(() => {
    startWorkoutSessionAction.mockReset();
    recordWorkoutSetAction.mockReset();
    completeWorkoutSessionAction.mockReset();
  });

  it("initially renders the DayDetailPanel (day cards), not the tracker", () => {
    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );
    expect(screen.getByText("Push Day")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Live workout" })).toBeNull();
  });

  it("on a started result, swaps to TrackerPanel without navigating", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: fakeSession });

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );

    // Open day 1 and click Start session.
    fireEvent.click(screen.getByText("Push Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined();
    });
    expect(startWorkoutSessionAction).toHaveBeenCalledWith("plan-a", 1);
  });

  it("threads the correct day for a different day card", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: fakeSession });

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );

    fireEvent.click(screen.getByText("Pull Day")); // day 2
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() => {
      expect(startWorkoutSessionAction).toHaveBeenCalledWith("plan-a", 2);
    });
  });

  it("on a conflict result, renders the conflict banner and stays on the plan view", async () => {
    startWorkoutSessionAction.mockResolvedValue({
      kind: "conflict",
      activePlanName: "Other Plan",
      activeDay: 5,
    });

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );

    fireEvent.click(screen.getByText("Push Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() => {
      const banner = screen.getByRole("alert");
      expect(banner.textContent).toContain("Other Plan");
      expect(banner.textContent).toContain("5");
    });
    // Did NOT swap to the tracker.
    expect(screen.queryByRole("region", { name: "Live workout" })).toBeNull();
    // Day cards still visible (card + open detail header both show the title).
    expect(screen.getAllByText("Push Day").length).toBeGreaterThanOrEqual(1);
  });
});

describe("PlanTrackerClient — completion returns to the plan view (BLOCKER #93)", () => {
  it("after a successful complete, dismisses the tracker and shows the plan/day grid again", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: fakeSession });
    completeWorkoutSessionAction.mockResolvedValue({
      ...fakeSession,
      status: "completed",
    });

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a">
        <div>Summary strip</div>
      </PlanTrackerClient>,
    );

    // Start day 1 → tracker takes over.
    fireEvent.click(screen.getByText("Push Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined();
    });

    // Complete the workout.
    fireEvent.click(screen.getByRole("button", { name: "Complete workout" }));

    // Tracker is dismissed; the plan view (children + day grid) is back.
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Live workout" })).toBeNull();
    });
    expect(screen.getByText("Summary strip")).toBeDefined();
    expect(screen.getAllByText("Push Day").length).toBeGreaterThanOrEqual(1);
  });
});

describe("PlanTrackerClient — thrown errors do not crash the render (CRITICAL #93)", () => {
  it("a thrown error from START sets an inline error and does NOT crash", async () => {
    startWorkoutSessionAction.mockRejectedValue(new Error("api_unreachable"));

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );

    fireEvent.click(screen.getByText("Push Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    const alert = await screen.findByTestId("tracker-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe(
      "We couldn't start the session. Please try again.",
    );
    // Did NOT swap to the tracker (no crash, plan view intact).
    expect(screen.queryByRole("region", { name: "Live workout" })).toBeNull();
    expect(screen.getAllByText("Push Day").length).toBeGreaterThanOrEqual(1);
  });

  it("a thrown error from RECORD sets an inline error and does NOT crash", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: fakeSession });
    recordWorkoutSetAction.mockRejectedValue(new Error("api_unreachable"));

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );

    fireEvent.click(screen.getByText("Push Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined());

    // Submit the set form → record throws.
    fireEvent.click(screen.getByRole("button", { name: "Complete set" }));

    const alert = await screen.findByTestId("tracker-error");
    expect(alert.textContent).toBe(
      "We couldn't save the set. Please try again.",
    );
    // Still on the tracker — no crash.
    expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined();
  });

  it("a thrown error from COMPLETE sets an inline error and does NOT crash", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: fakeSession });
    completeWorkoutSessionAction.mockRejectedValue(new Error("api_unreachable"));

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );

    fireEvent.click(screen.getByText("Push Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Complete workout" }));

    const alert = await screen.findByTestId("tracker-error");
    expect(alert.textContent).toBe(
      "We couldn't complete the workout. Please try again.",
    );
    // Complete failed → still on the tracker (not dismissed).
    expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined();
  });

  it("an unmapped/unknown error code renders the generic fallback, NOT the start-error text (CRITICAL regression guard)", () => {
    // The real useWorkoutSession hook only ever produces the 3 known codes
    // (tracker_error_start/record/complete) — inject a code it never
    // produces to prove the fallback is neutral, not mislabeled as "start".
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict: undefined,
      error: "some_unknown_error",
      syncNotice: undefined,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
    });

    renderWithIntl(<PlanTrackerClient program={program} planId="plan-a" />);

    const alert = screen.getByTestId("tracker-error");
    expect(alert.textContent).toBe("Something went wrong. Please try again.");
    expect(alert.textContent).not.toContain("start the session");

    spy.mockRestore();
  });

  it("renders a 'reload to sync' prompt when the hook surfaces a stale-action syncNotice (Phase 4 web offline)", () => {
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict: undefined,
      error: undefined,
      syncNotice: "reload_required",
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
    });

    renderWithIntl(<PlanTrackerClient program={program} planId="plan-a" />);

    expect(screen.getByTestId("tracker-sync-notice").textContent).toContain(
      "reload the page",
    );

    spy.mockRestore();
  });

  it("renders a 'session expired' prompt when the hook surfaces an auth_required syncNotice (Judgment Day fix #3/#4)", () => {
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict: undefined,
      error: undefined,
      syncNotice: "auth_required",
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
    });

    renderWithIntl(<PlanTrackerClient program={program} planId="plan-a" />);

    expect(screen.getByTestId("tracker-sync-notice").textContent).toContain(
      "session expired",
    );

    spy.mockRestore();
  });

  it("surfaces a 'changes discarded' notice when the hook reports a poison-dropped mutation (Judgment Day fix #3 — never silent)", () => {
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict: undefined,
      error: undefined,
      syncNotice: "dropped",
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
    });

    renderWithIntl(<PlanTrackerClient program={program} planId="plan-a" />);

    expect(screen.getByTestId("tracker-sync-notice").textContent).toContain(
      "couldn't be saved",
    );

    spy.mockRestore();
  });
});

describe("PlanTrackerClient — plan/day identity in the active tracker (CRITICAL #93)", () => {
  it("shows the plan name and the started day above the tracker", async () => {
    startWorkoutSessionAction.mockResolvedValue({ kind: "ok", session: fakeSession });

    renderWithIntl(
      <PlanTrackerClient
        program={program}
        planId="plan-a"
        planName="Summer Cut"
       
      />,
    );

    fireEvent.click(screen.getByText("Push Day")); // day 1
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() => expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined());

    const identity = screen.getByTestId("tracker-identity");
    expect(identity.textContent).toContain("Summer Cut");
    expect(identity.textContent).toContain("Day 1");
  });
});

describe("PlanTrackerClient — conflict then retry (#93)", () => {
  it("after a conflict, opening a different day and starting succeeds (state clears)", async () => {
    startWorkoutSessionAction
      .mockResolvedValueOnce({
        kind: "conflict",
        activePlanName: "Other Plan",
        activeDay: 5,
      })
      .mockResolvedValueOnce({ kind: "ok", session: { ...fakeSession, day: 2 } });

    renderWithIntl(
      <PlanTrackerClient program={program} planId="plan-a" />,
    );

    // First attempt on day 1 → conflict.
    fireEvent.click(screen.getByText("Push Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await screen.findByRole("alert");

    // Open a different day (day 2) and start again → success clears conflict.
    fireEvent.click(screen.getByText("Pull Day"));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await waitFor(() => expect(screen.getByRole("region", { name: "Live workout" })).toBeDefined());
    expect(startWorkoutSessionAction).toHaveBeenNthCalledWith(2, "plan-a", 2);
    // Conflict banner cleared (swapped to tracker view).
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
