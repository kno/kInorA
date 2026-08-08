// @vitest-environment jsdom
/**
 * Tests for PlanStatusClient — verifies that the Regenerate button calls the
 * server action, NOT a direct browser fetch to the API.
 *
 * Fix 4: handleRegenerate must route through regeneratePlanAction (server
 * action in create-plan/actions.ts) so the browser never fetches the API
 * directly. PlanStatusClient must reference NO API base URL after this fix.
 *
 * Issue #42: PlanStatusClient must NOT accept or forward a session token. The
 * browser authenticates the WS via the same-origin kinora_session cookie, so
 * usePlanWs must be called WITHOUT a token — the token must never reach client JS.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { PlanStatusClient } from "../PlanStatusClient";

// --- Module mocks ---

const usePlanWs = vi.fn();
const getPlanStatusAction = vi.fn();
const regeneratePlanAction = vi.fn();
const routerReplace = vi.fn();

vi.mock("@/hooks/use-plan-ws", () => ({
  usePlanWs: (...args: unknown[]) => usePlanWs(...args),
}));

// PlanStatusClient redirects to the canonical `/plan` page on ready via
// `router.replace` (post-generation navigation). Mock next/navigation so the
// App Router hook resolves without a mounted router in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

vi.mock("../actions", () => ({
  getPlanStatusAction: (...args: unknown[]) => getPlanStatusAction(...args),
}));

// regeneratePlanAction lives in create-plan/actions
vi.mock("@/app/(app)/create-plan/actions", () => ({
  regeneratePlanAction: (...args: unknown[]) => regeneratePlanAction(...args),
}));

// TrackerPanel is exercised in depth elsewhere (TrackerPanel.test.tsx and
// tracker.test.tsx). Stub it here so the active-session branch renders without
// a real session shape — these tests only assert redirect behavior.
vi.mock("../TrackerPanel", () => ({
  TrackerPanel: () => <div data-testid="tracker-panel" />,
}));

// PlanStatusView is a presentational component — stub it to simplify assertions
vi.mock("../PlanStatusView", () => ({
  PlanStatusView: (props: {
    status: string;
    planId: string;
    specId?: string;
    onRegenerate?: () => void;
  }) => (
    <div>
      <span data-testid="status">{props.status}</span>
      {props.onRegenerate && (
        <button onClick={props.onRegenerate} data-testid="regenerate-btn">
          Regenerate
        </button>
      )}
    </div>
  ),
}));

// Pass-through mock (real implementation) so a single test below can
// `vi.spyOn` the hook's return value to inject an error code the REAL hook
// never produces (an unmapped/unknown code) — every other test in this file
// is unaffected, since it doesn't touch the hook's `error` state.
vi.mock("@/app/(app)/plan/use-workout-session", async () => {
  const actual = await vi.importActual<
    typeof import("@/app/(app)/plan/use-workout-session")
  >("@/app/(app)/plan/use-workout-session");
  return { ...actual };
});

import * as useWorkoutSessionModule from "@/app/(app)/plan/use-workout-session";

afterEach(() => {
  vi.clearAllMocks();
});

function defaultWsReturn(status = "generating") {
  usePlanWs.mockReturnValue({ status });
}

describe("PlanStatusClient — Regenerate button (Fix 4)", () => {
  it("calls regeneratePlanAction (server action) when Regenerate is clicked", async () => {
    defaultWsReturn("failed");
    regeneratePlanAction.mockResolvedValue({ planId: "plan-1", status: "generating" });

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        specId="spec-1"
        initialStatus="failed"
      />
    );

    const btn = screen.getByTestId("regenerate-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(regeneratePlanAction).toHaveBeenCalledWith("spec-1");
    });
  });

  it("does NOT call fetch() directly when Regenerate is clicked", async () => {
    defaultWsReturn("failed");
    regeneratePlanAction.mockResolvedValue({ planId: "plan-1", status: "generating" });

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        specId="spec-2"
        initialStatus="failed"
      />
    );

    fireEvent.click(screen.getByTestId("regenerate-btn"));

    await waitFor(() => {
      expect(regeneratePlanAction).toHaveBeenCalled();
    });

    // The browser must NOT call fetch directly — the server action handles it
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("shows 'generating' status while awaiting the regenerate action", async () => {
    defaultWsReturn("failed");
    // Never resolves during this test — simulates in-flight
    regeneratePlanAction.mockReturnValue(new Promise(() => {}));

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        specId="spec-1"
        initialStatus="failed"
      />
    );

    fireEvent.click(screen.getByTestId("regenerate-btn"));

    // Status should switch to "generating" while the action is pending
    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("generating");
    });
  });

  it("surfaces an error banner when regeneratePlanAction rejects, instead of no-op'ing silently", async () => {
    defaultWsReturn("failed");
    regeneratePlanAction.mockRejectedValue(new Error("network error"));

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        specId="spec-1"
        initialStatus="failed"
      />
    );

    fireEvent.click(screen.getByTestId("regenerate-btn"));

    const alert = await screen.findByTestId("regenerate-error");
    expect(alert.textContent).toBe("Something went wrong. Please try again.");
  });

  it("clears a previous regenerate-error banner on a subsequent successful click", async () => {
    defaultWsReturn("failed");
    regeneratePlanAction.mockRejectedValueOnce(new Error("network error"));
    regeneratePlanAction.mockResolvedValueOnce({ planId: "plan-1", status: "generating" });

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        specId="spec-1"
        initialStatus="failed"
      />
    );

    fireEvent.click(screen.getByTestId("regenerate-btn"));
    await screen.findByTestId("regenerate-error");

    fireEvent.click(screen.getByTestId("regenerate-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("regenerate-error")).toBeNull();
    });
  });

  it("does not call regeneratePlanAction when specId is undefined", async () => {
    defaultWsReturn("failed");

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        initialStatus="failed"
        // specId deliberately omitted
      />
    );

    // No regenerate button without specId (PlanStatusView only renders it when onRegenerate present)
    // The guard is inside the handler — but view won't render the button without specId
    expect(regeneratePlanAction).not.toHaveBeenCalled();
  });
});

describe("PlanStatusClient — no session token exposed to client JS (Fix #42)", () => {
  it("calls usePlanWs WITHOUT a token — WS auth relies on the same-origin cookie", () => {
    defaultWsReturn("generating");

    renderWithIntl(
      <PlanStatusClient
        planId="plan-1"
        specId="spec-1"
        initialStatus="generating"
      />
    );

    // usePlanWs(planId, options) — options must NOT carry a token.
    expect(usePlanWs).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({ initialStatus: "generating" }),
    );
    const options = usePlanWs.mock.calls[0]![1] as Record<string, unknown>;
    expect(options.token).toBeUndefined();
  });
});

describe("PlanStatusClient — post-generation redirect to canonical /plan", () => {
  it("redirects to /plan?planId=<id> (replace) on a generating → ready WS transition with no active session", async () => {
    // SSR rendered while still "generating"; the WS then pushes "ready". The
    // resolved status drives the effect, which hands off to the canonical
    // page. `replace` (not `push`) keeps the intermediate /plan/[id] screen out
    // of the Back-button history.
    defaultWsReturn("ready");
    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="generating" />,
    );

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/plan?planId=plan-1");
    });
  });

  it("does NOT redirect while the plan is still generating", () => {
    defaultWsReturn("generating");
    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="generating" />,
    );
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("does NOT redirect when there is an active workout session (never yank the tracker)", () => {
    // A ready plan with an active session must stay on the tracker, not redirect.
    defaultWsReturn("ready");
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: {
        id: "session-1",
        workoutPlanId: "plan-1",
        status: "active",
        startedAt: "2026-07-06T09:00:00.000Z",
        exercises: [],
      },
      activeDay: 1,
      conflict: undefined,
      error: undefined,
      syncNotice: undefined,
      autoCloseNotice: undefined,
      discardFailed: false,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    expect(routerReplace).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("PlanStatusClient — actionable conflict banner (17b scope A)", () => {
  const conflict = {
    activePlanName: "Summer Cut",
    activeDay: 3,
    activeSessionId: "session-blocking",
    activeStartedAt: "2026-08-05T09:00:00.000Z",
  };

  it("names the blocking session's start date and offers Resume/Discard, no focus assertion", () => {
    defaultWsReturn("ready");
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict,
      autoCloseNotice: undefined,
      discardFailed: false,
      error: undefined,
      syncNotice: undefined,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Aug 5, 2026");
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDefined();

    spy.mockRestore();
  });

  it("Resume calls handleResumeSession with the blocking session's id", () => {
    defaultWsReturn("ready");
    const handleResumeSession = vi.fn();
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict,
      autoCloseNotice: undefined,
      discardFailed: false,
      error: undefined,
      syncNotice: undefined,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession,
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(handleResumeSession).toHaveBeenCalledWith("session-blocking");
    spy.mockRestore();
  });

  it("Discard requires one confirmation before calling handleDiscardSession", () => {
    defaultWsReturn("ready");
    const handleDiscardSession = vi.fn();
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict,
      autoCloseNotice: undefined,
      discardFailed: false,
      error: undefined,
      syncNotice: undefined,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession,
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(handleDiscardSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, discard" }));
    expect(handleDiscardSession).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("does not nest a second role=alert region for the discardFailed message", () => {
    defaultWsReturn("ready");
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict,
      autoCloseNotice: undefined,
      discardFailed: true,
      error: undefined,
      syncNotice: undefined,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    // The conflict container already owns role="alert"; the discardFailed
    // message must be role="status" so screen readers do not announce two
    // nested alert regions for the same event.
    const discardFailedMessage = screen.getByText("We couldn't discard that session. Try again.");
    expect(discardFailedMessage.getAttribute("role")).toBe("status");
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    spy.mockRestore();
  });

  it("renders a non-blocking auto-close notice when the hook surfaces one", () => {
    defaultWsReturn("ready");
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: {
        id: "session-1",
        workoutPlanId: "plan-1",
        status: "active",
        startedAt: "2026-08-07T09:00:00.000Z",
        exercises: [],
      },
      activeDay: 1,
      conflict: undefined,
      autoCloseNotice: { id: "session-stale", startedAt: "2026-08-04T08:00:00.000Z" },
      discardFailed: false,
      error: undefined,
      syncNotice: undefined,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Aug 4, 2026");

    spy.mockRestore();
  });
});

describe("PlanStatusClient — unmapped error code (CRITICAL regression guard)", () => {
  it("renders the generic fallback, NOT the start-error text, for an unknown error code", () => {
    defaultWsReturn("failed");
    // The real useWorkoutSession hook only ever produces the 3 known codes
    // (tracker_error_start/record/complete) — inject a code it never
    // produces to prove the fallback is neutral, not mislabeled as "start".
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict: undefined,
      error: "some_unknown_error",
      syncNotice: undefined,
      autoCloseNotice: undefined,
      discardFailed: false,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="failed" />,
    );

    const alert = screen.getByTestId("tracker-error");
    expect(alert.textContent).toBe("Something went wrong. Please try again.");
    expect(alert.textContent).not.toContain("start the session");

    spy.mockRestore();
  });
});

describe("PlanStatusClient — offline sync notices (Judgment Day fix #3/#4)", () => {
  it("renders a 'session expired' prompt when the hook surfaces an auth_required syncNotice", () => {
    defaultWsReturn("generating");
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict: undefined,
      error: undefined,
      syncNotice: "auth_required",
      autoCloseNotice: undefined,
      discardFailed: false,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    expect(screen.getByTestId("tracker-sync-notice").textContent).toContain(
      "session expired",
    );

    spy.mockRestore();
  });

  it("surfaces a 'changes discarded' notice when the hook reports a poison-dropped mutation", () => {
    defaultWsReturn("generating");
    const spy = vi.spyOn(useWorkoutSessionModule, "useWorkoutSession").mockReturnValue({
      activeSession: undefined,
      activeDay: undefined,
      conflict: undefined,
      error: undefined,
      syncNotice: "dropped",
      autoCloseNotice: undefined,
      discardFailed: false,
      handleStartWorkout: vi.fn(),
      handleRecordSet: vi.fn(),
      handleCompleteWorkout: vi.fn(),
      handleDiscardSession: vi.fn(),
      handleResumeSession: vi.fn(),
    });

    renderWithIntl(
      <PlanStatusClient planId="plan-1" specId="spec-1" initialStatus="ready" />,
    );

    expect(screen.getByTestId("tracker-sync-notice").textContent).toContain(
      "couldn't be saved",
    );

    spy.mockRestore();
  });
});
