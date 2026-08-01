import { describe, it, expect, vi, afterEach } from "vitest";

// --- Module mocks ---
const cookieGet = vi.fn();
const fetchTrainerPlan = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

vi.mock("@/app/(app)/create-plan/plan-draft-client", () => ({
  fetchTrainerPlan: (...args: unknown[]) => fetchTrainerPlan(...args),
}));

import { getTrainerPlanAction } from "../actions";

afterEach(() => {
  vi.clearAllMocks();
});

describe("getTrainerPlanAction", () => {
  it("calls fetchTrainerPlan with the session token from the cookie", async () => {
    cookieGet.mockReturnValue({ value: "session-tok-abc" });
    fetchTrainerPlan.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "ready" },
    });

    await getTrainerPlanAction();

    expect(fetchTrainerPlan).toHaveBeenCalledWith("session-tok-abc");
  });

  it("returns the result from fetchTrainerPlan on success", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    const okResult = { kind: "ok", plan: { id: "plan-1", status: "ready" } };
    fetchTrainerPlan.mockResolvedValue(okResult);

    const result = await getTrainerPlanAction();

    expect(result).toEqual(okResult);
  });

  it("returns the error result when fetchTrainerPlan fails (e.g. no active assignment)", async () => {
    cookieGet.mockReturnValue({ value: "tok" });
    fetchTrainerPlan.mockResolvedValue({ kind: "error", message: "forbidden" });

    const result = await getTrainerPlanAction();

    expect(result).toEqual({ kind: "error", message: "forbidden" });
  });

  it("passes undefined token to fetchTrainerPlan when no session cookie exists", async () => {
    cookieGet.mockReturnValue(undefined);
    fetchTrainerPlan.mockResolvedValue({ kind: "error", message: "no_session" });

    await getTrainerPlanAction();

    expect(fetchTrainerPlan).toHaveBeenCalledWith(undefined);
  });
});
