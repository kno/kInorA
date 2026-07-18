// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { DashboardTodayBlock } from "../DashboardTodayBlock";

describe("DashboardTodayBlock", () => {
  it("renders the presentational exercise list from the catalog", () => {
    renderWithIntl(<DashboardTodayBlock />);

    expect(screen.getByText("Today's block")).toBeDefined();
    expect(screen.getByText("Incline dumbbell press")).toBeDefined();
    expect(screen.getByText("Seated overhead press")).toBeDefined();
    expect(screen.getByText("Assisted dips")).toBeDefined();
  });

  it("toggles an exercise check and raises a completion toast", () => {
    renderWithIntl(<DashboardTodayBlock />);

    const check = screen.getByRole("button", { name: "Mark Incline dumbbell press" });
    expect(check.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(check);

    expect(check.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Exercise completed");
  });
});
