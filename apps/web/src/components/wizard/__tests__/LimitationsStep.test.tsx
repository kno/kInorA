// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@kinora/i18n";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { LimitationsStep } from "../LimitationsStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LimitationsStep", () => {
  it("renders a free-text input for limitations", () => {
    renderWithIntl(<LimitationsStep value={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /limitation/i })).toBeTruthy();
  });

  it("adds a typed limitation as { text, isWarning: true }", () => {
    const onSelect = vi.fn();
    renderWithIntl(<LimitationsStep value={[]} onSelect={onSelect} />);
    const input = screen.getByRole("textbox", { name: /limitation/i });
    fireEvent.change(input, { target: { value: "knee pain" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(onSelect).toHaveBeenCalledWith([
      { text: "knee pain", isWarning: true },
    ]);
  });

  it("appends to existing limitations without dropping them", () => {
    const onSelect = vi.fn();
    renderWithIntl(
      <LimitationsStep
        value={[{ text: "shoulder", isWarning: true }]}
        onSelect={onSelect}
      />,
    );
    const input = screen.getByRole("textbox", { name: /limitation/i });
    fireEvent.change(input, { target: { value: "back pain" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(onSelect).toHaveBeenCalledWith([
      { text: "shoulder", isWarning: true },
      { text: "back pain", isWarning: true },
    ]);
  });

  it("adds the limitation on Enter keypress", () => {
    const onSelect = vi.fn();
    renderWithIntl(<LimitationsStep value={[]} onSelect={onSelect} />);
    const input = screen.getByRole("textbox", { name: /limitation/i });
    fireEvent.change(input, { target: { value: "wrist strain" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith([
      { text: "wrist strain", isWarning: true },
    ]);
  });

  it("does not add an empty or whitespace-only limitation", () => {
    const onSelect = vi.fn();
    renderWithIntl(<LimitationsStep value={[]} onSelect={onSelect} />);
    const input = screen.getByRole("textbox", { name: /limitation/i });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("removes the clicked chip and leaves the rest intact", () => {
    const onSelect = vi.fn();
    renderWithIntl(
      <LimitationsStep
        value={[
          { text: "knee pain", isWarning: true },
          { text: "wrist strain", isWarning: true },
        ]}
        onSelect={onSelect}
      />,
    );
    // wizard.chip.removeAria interpolates {name} — assert the actual resolved
    // accessible name, not just presence.
    const remove = screen.getByRole("button", { name: "Remove knee pain" });
    fireEvent.click(remove);
    expect(onSelect).toHaveBeenCalledWith([
      { text: "wrist strain", isWarning: true },
    ]);
    // The second chip's remove button should exist too
    expect(screen.getByRole("button", { name: "Remove wrist strain" })).toBeTruthy();
  });

  it("renders the existing limitations as a list (empty list is valid)", () => {
    const { rerender } = renderWithIntl(<LimitationsStep value={[]} onSelect={vi.fn()} />);
    // empty list: no limitation entries shown
    expect(screen.queryByText("knee pain")).toBeNull();
    // rerender replaces the ui root — re-wrap in the provider so the
    // component's useTranslations() call still resolves the real catalog.
    rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
        <LimitationsStep
          value={[{ text: "knee pain", isWarning: true }]}
          onSelect={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("knee pain")).toBeTruthy();
  });
});
