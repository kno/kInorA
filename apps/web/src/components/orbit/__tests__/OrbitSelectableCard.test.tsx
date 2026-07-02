// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { OrbitSelectableCard } from "../OrbitSelectableCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * OrbitSelectableCard — the selectable option card primitive from the Open
 * Design `.option-card`/`.obj-card`. Tests verify the button semantics and
 * the selection/disabled behavior, not styling.
 */
describe("OrbitSelectableCard", () => {
  it("renders its label and children content", () => {
    render(
      <OrbitSelectableCard label="Strength">
        Build raw power
      </OrbitSelectableCard>,
    );
    expect(screen.getByText("Strength")).toBeTruthy();
    expect(screen.getByText("Build raw power")).toBeTruthy();
  });

  it("exposes role=button and reflects aria-pressed from selected", () => {
    render(<OrbitSelectableCard label="Gym" selected />);
    const card = screen.getByRole("button", { name: /Gym/ });
    expect(card.getAttribute("aria-pressed")).toBe("true");
  });

  it("reports aria-pressed=false when not selected", () => {
    render(<OrbitSelectableCard label="Home" />);
    const card = screen.getByRole("button", { name: /Home/ });
    expect(card.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(<OrbitSelectableCard label="Outdoor" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Outdoor/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect on Enter/Space keyboard activation", () => {
    const onSelect = vi.fn();
    render(<OrbitSelectableCard label="Keyboard" onSelect={onSelect} />);
    const card = screen.getByRole("button", { name: /Keyboard/ });
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("ignores keys other than Enter/Space", () => {
    const onSelect = vi.fn();
    render(<OrbitSelectableCard label="Other" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Other/ }), { key: "a" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not call onSelect and marks aria-disabled when disabled", () => {
    const onSelect = vi.fn();
    render(
      <OrbitSelectableCard label="Locked" onSelect={onSelect} disabled />,
    );
    const card = screen.getByRole("button", { name: /Locked/ });
    expect(card.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(card);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the check indicator on a default (non-media) card", () => {
    render(<OrbitSelectableCard label="Default" selected />);
    const card = screen.getByRole("button", { name: /Default/ });
    // The check glyph path is present on the default treatment.
    expect(card.querySelector('path[d="M5 13l4 4L19 7"]')).not.toBeNull();
  });

  describe("media variant", () => {
    it("renders the media background and hides the checkmark", () => {
      render(
        <OrbitSelectableCard
          label="Barbell"
          mediaBackground={<img src="/x.webp" alt="a barbell" />}
        />,
      );
      const card = screen.getByRole("button", { name: /Barbell/ });
      // The media node is rendered.
      const img = card.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toBe("/x.webp");
      // No checkmark in the media variant.
      expect(card.querySelector('path[d="M5 13l4 4L19 7"]')).toBeNull();
    });

    it("keeps role=button, aria-pressed and an accessible name in media mode", () => {
      render(
        <OrbitSelectableCard
          label="Kettlebell"
          selected
          mediaBackground={<img src="/k.webp" alt="a kettlebell" />}
        />,
      );
      // Accessible name resolves from the overprinted, real label text.
      const card = screen.getByRole("button", { name: "Kettlebell" });
      expect(card.getAttribute("aria-pressed")).toBe("true");
    });

    it("activates via click and keyboard in media mode", () => {
      const onSelect = vi.fn();
      render(
        <OrbitSelectableCard
          label="Bench"
          onSelect={onSelect}
          mediaBackground={<img src="/b.webp" alt="a bench" />}
        />,
      );
      const card = screen.getByRole("button", { name: /Bench/ });
      fireEvent.click(card);
      fireEvent.keyDown(card, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledTimes(2);
    });
  });
});
