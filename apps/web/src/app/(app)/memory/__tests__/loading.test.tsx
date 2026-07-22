// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import MemoryLoading from "../loading.js";

describe("MemoryLoading", () => {
  it("shows an accessible loading indicator for memory management", () => {
    renderWithIntl(<MemoryLoading />);

    expect(screen.getByRole("status").textContent).toContain("Loading your memory");
    expect(screen.getByRole("progressbar", { name: "Loading memory" }).getAttribute("aria-busy")).toBe("true");
  });
});
