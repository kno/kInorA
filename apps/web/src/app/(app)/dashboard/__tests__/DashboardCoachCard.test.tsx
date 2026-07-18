// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { DashboardCoachCard } from "../DashboardCoachCard";

describe("DashboardCoachCard", () => {
  it("renders the presentational coach copy from the catalog", () => {
    renderWithIntl(<DashboardCoachCard />);

    expect(screen.getByText("Coach AI")).toBeDefined();
    expect(screen.getByText(/Train hard/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Apply advice" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
  });

  it("swaps the body text and shows a toast when advice is applied", () => {
    renderWithIntl(<DashboardCoachCard />);

    fireEvent.click(screen.getByRole("button", { name: "Apply advice" }));

    expect(screen.getByText(/Advice applied/)).toBeDefined();
    expect(screen.getByRole("status")).toBeDefined();
  });
});
