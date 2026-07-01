// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DurationStep } from "../DurationStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DurationStep", () => {
  it("renders a card for each session-duration option", () => {
    render(<DurationStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /30 min/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /60 min/i })).toBeTruthy();
  });

  it("offers a static 15-minute option", () => {
    render(<DurationStep onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /15 min/i })).toBeTruthy();
  });

  it("calls onSelect with the duration in minutes", () => {
    const onSelect = vi.fn();
    render(<DurationStep onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /45 min/i }));
    expect(onSelect).toHaveBeenCalledWith(45);
  });

  it("reflects the pre-selected duration", () => {
    render(<DurationStep value={90} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /90 min/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  describe("custom duration input", () => {
    it("renders a numeric custom-duration input", () => {
      render(<DurationStep onSelect={vi.fn()} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      expect(input).toBeTruthy();
      expect(input.getAttribute("type")).toBe("number");
    });

    it("calls onSelect with a valid typed duration on Set", () => {
      const onSelect = vi.fn();
      render(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "75" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).toHaveBeenCalledWith(75);
    });

    it("submits the typed duration on Enter", () => {
      const onSelect = vi.fn();
      render(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "50" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledWith(50);
    });

    it("rejects an empty custom value", () => {
      const onSelect = vi.fn();
      render(<DurationStep onSelect={onSelect} />);
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects zero", () => {
      const onSelect = vi.fn();
      render(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects a negative value", () => {
      const onSelect = vi.fn();
      render(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "-30" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects an out-of-range value", () => {
      const onSelect = vi.fn();
      render(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "500" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("clears the error once a valid value is submitted", () => {
      const onSelect = vi.fn();
      render(<DurationStep onSelect={onSelect} />);
      const input = screen.getByRole("spinbutton", { name: /custom duration/i });
      fireEvent.change(input, { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(screen.getByRole("alert")).toBeTruthy();
      fireEvent.change(input, { target: { value: "40" } });
      fireEvent.click(screen.getByRole("button", { name: /set duration/i }));
      expect(onSelect).toHaveBeenCalledWith(40);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("reflects a custom (non-static) selected value in the input", () => {
      render(<DurationStep value={75} onSelect={vi.fn()} />);
      const input = screen.getByRole("spinbutton", {
        name: /custom duration/i,
      }) as HTMLInputElement;
      expect(input.value).toBe("75");
    });
  });
});
