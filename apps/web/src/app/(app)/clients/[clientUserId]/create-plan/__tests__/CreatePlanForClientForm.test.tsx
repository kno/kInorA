// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { CreatePlanForClientForm } from "../CreatePlanForClientForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreatePlanForClientForm", () => {
  it("submits the minimal spec fields to the client-owned route and navigates to the new plan", async () => {
    const createPlanForClientAction = vi
      .fn()
      .mockResolvedValue({ kind: "ok", planId: "plan_1", status: "generating" });

    renderWithIntl(
      <CreatePlanForClientForm
        clientUserId="user_1"
        createPlanForClientAction={createPlanForClientAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => {
      expect(createPlanForClientAction).toHaveBeenCalledWith("user_1", {
        goal: "strength",
        daysPerWeek: 3,
        sessionDurationMinutes: 45,
        location: "gym",
        equipment: [],
        limitations: [],
      });
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/plan/plan_1");
    });
  });

  it("shows a forbidden-specific error when the trainer is not authorized for this client", async () => {
    const createPlanForClientAction = vi
      .fn()
      .mockResolvedValue({ kind: "error", message: "forbidden" });

    renderWithIntl(
      <CreatePlanForClientForm
        clientUserId="user_1"
        createPlanForClientAction={createPlanForClientAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("not authorized");
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a generic error for any other failure", async () => {
    const createPlanForClientAction = vi
      .fn()
      .mockResolvedValue({ kind: "error", message: "incomplete_spec" });

    renderWithIntl(
      <CreatePlanForClientForm
        clientUserId="user_1"
        createPlanForClientAction={createPlanForClientAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("couldn't create");
    });
  });
});
