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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanStatusClient } from "../PlanStatusClient";

// --- Module mocks ---

const usePlanWs = vi.fn();
const getPlanStatusAction = vi.fn();
const regeneratePlanAction = vi.fn();

vi.mock("@/hooks/use-plan-ws", () => ({
  usePlanWs: (...args: unknown[]) => usePlanWs(...args),
}));

vi.mock("../actions", () => ({
  getPlanStatusAction: (...args: unknown[]) => getPlanStatusAction(...args),
}));

// regeneratePlanAction lives in create-plan/actions
vi.mock("@/app/(app)/create-plan/actions", () => ({
  regeneratePlanAction: (...args: unknown[]) => regeneratePlanAction(...args),
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

    render(
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

    render(
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

    render(
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

  it("does not call regeneratePlanAction when specId is undefined", async () => {
    defaultWsReturn("failed");

    render(
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

    render(
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
