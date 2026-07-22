// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import ProfileLoading from "../loading.js";

describe("ProfileLoading", () => {
  it("shows an accessible loading indicator for the profile fetch", () => {
    renderWithIntl(<ProfileLoading />);

    expect(screen.getByRole("status").textContent).toContain("Loading your profile");
    expect(
      screen.getByRole("progressbar", { name: "Loading profile" }).getAttribute(
        "aria-busy",
      ),
    ).toBe("true");
    expect(
      screen.getByText("We are getting your latest profile details."),
    ).toBeDefined();
  });
});
