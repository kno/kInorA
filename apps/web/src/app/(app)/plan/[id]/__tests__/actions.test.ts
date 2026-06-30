import { describe, it, expect, vi, afterEach } from "vitest";

// --- Module mocks ---
const cookieGet = vi.fn();
const fetchPlanStatus = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

vi.mock("@/app/(app)/create-plan/plan-draft-client", () => ({
  fetchPlanStatus: (...args: unknown[]) => fetchPlanStatus(...args),
}));

import { getPlanStatusAction } from "../actions";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("getPlanStatusAction", () => {
  it("calls fetchPlanStatus with the planId and session token from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "session-tok-abc" });
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "ready", program: null, specId: "spec-1" },
    });

    await getPlanStatusAction("plan-1");

    expect(fetchPlanStatus).toHaveBeenCalledWith("plan-1", "session-tok-abc");
  });

  it("returns the plan status result from fetchPlanStatus on success", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    fetchPlanStatus.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-42", status: "ready", program: { weeklySessions: [] }, specId: "spec-42" },
    });

    const result = await getPlanStatusAction("plan-42");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.plan.id).toBe("plan-42");
      expect(result.plan.status).toBe("ready");
    }
  });

  it("returns the error result when fetchPlanStatus fails", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    fetchPlanStatus.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const result = await getPlanStatusAction("plan-99");

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("api_unreachable");
    }
  });

  it("passes undefined token to fetchPlanStatus when no session cookie exists", async () => {
    cookieGet.mockReturnValue(undefined);
    fetchPlanStatus.mockResolvedValue({ kind: "error", message: "no_session" });

    await getPlanStatusAction("plan-1");

    expect(fetchPlanStatus).toHaveBeenCalledWith("plan-1", undefined);
  });
});
