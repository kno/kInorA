// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import { catalogs } from "@kinora/i18n";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { FrequencyStep } from "../FrequencyStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FrequencyStep", () => {
  it("renders a card for each supported day-count", () => {
    renderWithIntl(<FrequencyStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /2 days/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /5 days/i })).toBeTruthy();
  });

  it("calls onSelect with the numeric day count", () => {
    const onSelect = vi.fn();
    renderWithIntl(<FrequencyStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /4 days/i }));
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it("reflects the pre-selected frequency", () => {
    renderWithIntl(<FrequencyStep value={3} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /3 days/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders the ICU plural 'other' branch (plural 'days') through the real cards", () => {
    // FREQUENCY_OPTIONS (2–6) never includes a count of 1, so the component
    // itself can only ever exercise the "other" branch — proven here with two
    // distinct counts (not a hardcoded string, the count is substituted).
    renderWithIntl(<FrequencyStep onSelect={vi.fn()} />);
    expect(screen.getByText("2 days")).toBeTruthy();
    expect(screen.getByText("5 days")).toBeTruthy();
  });

  it("resolves both ICU plural branches of wizard.frequency.days directly against the real catalog", () => {
    // FrequencyStep structurally can't reach count=1 (min offered is 2), so the
    // "one" branch is proven here directly against the same real EN catalog and
    // the same ICU engine (`use-intl/core`'s `createTranslator`) next-intl uses.
    const t = createTranslator({ locale: "en", messages: catalogs.en });
    expect(t("wizard.frequency.days", { n: 1 })).toBe("1 day");
    expect(t("wizard.frequency.days", { n: 3 })).toBe("3 days");
  });
});
