// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import { catalogs } from "@kinora/i18n";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { DurationStep } from "../DurationStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DurationStep", () => {
  it("renders a card for each session-duration option", () => {
    renderWithIntl(<DurationStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /30 min/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /60 min/i })).toBeTruthy();
  });

  it("offers a static 15-minute option", () => {
    renderWithIntl(<DurationStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /15 min/i })).toBeTruthy();
  });

  it("calls onSelect with the duration and a preset source on preset click", () => {
    const onSelect = vi.fn();
    renderWithIntl(<DurationStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /45 min/i }));
    // A preset click commits with source "preset" so the shell auto-advances.
    expect(onSelect).toHaveBeenCalledWith(45, "preset");
  });

  it("reflects the pre-selected duration", () => {
    renderWithIntl(<DurationStep value={90} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /90 min/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  // wizard.duration.min is `{n, plural, one {# min} other {# min}}` — "min" is
  // plural-invariant in EN/ES, but the ICU engine must still resolve BOTH
  // branches (not just render "other" by construction). DURATION_OPTIONS
  // (15–90) never includes 1, so the "one" branch is proven directly against
  // the real catalog with the same ICU engine next-intl uses.
  it("renders the ICU plural 'other' branch through the real cards (30, 60 min)", () => {
    renderWithIntl(<DurationStep onSelect={vi.fn()} />);
    expect(screen.getByText("30 min")).toBeTruthy();
    expect(screen.getByText("60 min")).toBeTruthy();
  });

  it("resolves both ICU plural branches of wizard.duration.min directly against the real catalog", () => {
    const t = createTranslator({ locale: "en", messages: catalogs.en });
    expect(t("wizard.duration.min", { n: 1 })).toBe("1 min");
    expect(t("wizard.duration.min", { n: 45 })).toBe("45 min");
  });

  describe("custom duration input", () => {
    it("renders a numeric custom-duration input", () => {
      renderWithIntl(<DurationStep onSelect={vi.fn()} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      expect(input).toBeTruthy();
      expect(input.getAttribute("type")).toBe("number");
    });

    it("calls onSelect with a valid typed duration and a custom source on Set", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "75" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).toHaveBeenCalledWith(75, "custom");
    });

    it("does NOT commit while typing — only on the Set confirm", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      // Typing a valid number must not commit/advance until confirmed.
      fireEvent.change(input, { target: { value: "75" } });
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).toHaveBeenCalledWith(75, "custom");
    });

    it("submits the typed duration on Enter", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "50" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledWith(50, "custom");
    });

    it("rejects an empty custom value", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects zero", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects a negative value", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "-30" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects an out-of-range value", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "500" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("clears the error once a valid value is submitted", () => {
      const onSelect = vi.fn();
      renderWithIntl(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(screen.getByRole("alert")).toBeTruthy();
      fireEvent.change(input, { target: { value: "40" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).toHaveBeenCalledWith(40, "custom");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("reflects a custom (non-static) selected value in the input", () => {
      renderWithIntl(<DurationStep value={75} onSelect={vi.fn()} />);
      const input = screen.getByRole("spinbutton", {
        name: /custom duration/i,
      }) as HTMLInputElement;
      expect(input.value).toBe("75");
    });
  });
});
