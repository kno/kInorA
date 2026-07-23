// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import BillingLoading from "../loading.js";

describe("BillingLoading", () => {
  it("shows an accessible loading indicator for the billing route", () => {
    renderWithIntl(<BillingLoading />);

    expect(screen.getByRole("status").textContent).toContain("Loading your billing");
    expect(screen.getByRole("progressbar", { name: "Loading billing" }).getAttribute("aria-busy")).toBe(
      "true",
    );
  });
});
