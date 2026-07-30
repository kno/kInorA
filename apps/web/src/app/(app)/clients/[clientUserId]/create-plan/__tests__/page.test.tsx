import { describe, expect, it, vi } from "vitest";

vi.mock("../../../actions", () => ({
  createPlanForClientAction: vi.fn(),
}));

import CreatePlanForClientPage from "../page";

describe("CreatePlanForClientPage", () => {
  it("threads the route's clientUserId param into CreatePlanForClientForm", async () => {
    const page = await CreatePlanForClientPage({
      params: Promise.resolve({ clientUserId: "user_42" }),
    });

    expect(page.props.clientUserId).toBe("user_42");
    expect(page.props.createPlanForClientAction).toBeTypeOf("function");
  });
});
