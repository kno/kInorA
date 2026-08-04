// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { ExerciseAttribution } from "../ExerciseAttribution";

/**
 * The attribution block is a LICENSING OBLIGATION, not decoration (see
 * `public/exercises/ATTRIBUTION.md`). These tests assert the notice is
 * user-visible, so removing it fails the suite rather than shipping quietly.
 */
describe("ExerciseAttribution", () => {
  it("credits Gym visual for the demonstration media", () => {
    renderWithIntl(<ExerciseAttribution />);
    expect(screen.getByText(/Gym visual/)).toBeDefined();
  });

  it("links to gymvisual.com", () => {
    renderWithIntl(<ExerciseAttribution />);
    const link = screen.getByRole("link", { name: "gymvisual.com" });
    expect(link.getAttribute("href")).toBe("https://gymvisual.com/");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("credits the MIT-licensed exercises-dataset for the data", () => {
    renderWithIntl(<ExerciseAttribution />);
    expect(screen.getByText(/MIT License/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "exercises-dataset on GitHub" }).getAttribute("href"),
    ).toBe("https://github.com/hasaneyldrm/exercises-dataset");
  });

  it("is exposed as a labelled landmark", () => {
    renderWithIntl(<ExerciseAttribution />);
    expect(screen.getByRole("complementary", { name: "Media and data attribution" })).toBeDefined();
  });
});
