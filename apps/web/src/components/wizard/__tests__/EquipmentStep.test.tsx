// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { EquipmentStep } from "../EquipmentStep";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EquipmentStep", () => {
  it("offers gym-specific options when location is gym", () => {
    render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Barbell/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Cable machine/i })).toBeTruthy();
  });

  it("offers a DIFFERENT (home) set when location is home", () => {
    render(<EquipmentStep location="home" value={[]} onSelect={vi.fn()} />);
    // Home does not expose the gym-only cable machine
    expect(screen.queryByRole("button", { name: /Cable machine/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Resistance bands/i })).toBeTruthy();
  });

  it("adds an item to the selection on click (multi-select)", () => {
    const onSelect = vi.fn();
    render(<EquipmentStep location="gym" value={["barbell"]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Dumbbells/i }));
    expect(onSelect).toHaveBeenCalledWith(["barbell", "dumbbells"]);
  });

  it("removes an already-selected item on click (toggle off)", () => {
    const onSelect = vi.fn();
    render(<EquipmentStep location="gym" value={["barbell"]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Barbell/i }));
    expect(onSelect).toHaveBeenCalledWith([]);
  });

  it("marks already-selected items as pressed", () => {
    render(<EquipmentStep location="gym" value={["barbell"]} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Barbell/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /Dumbbells/i }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  describe("manual equipment entries", () => {
    it("renders a text input for custom equipment", () => {
      render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
      expect(screen.getByRole("textbox", { name: /add equipment/i })).toBeTruthy();
    });

    it("adds a typed custom entry to the selection on Add", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={["barbell"]} onSelect={onSelect} />);
      const input = screen.getByRole("textbox", { name: /add equipment/i });
      fireEvent.change(input, { target: { value: "sled" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onSelect).toHaveBeenCalledWith(["barbell", "sled"]);
    });

    it("adds a custom entry on Enter keypress", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={[]} onSelect={onSelect} />);
      const input = screen.getByRole("textbox", { name: /add equipment/i });
      fireEvent.change(input, { target: { value: "battle ropes" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledWith(["battle ropes"]);
    });

    it("trims surrounding whitespace before adding", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={[]} onSelect={onSelect} />);
      const input = screen.getByRole("textbox", { name: /add equipment/i });
      fireEvent.change(input, { target: { value: "  medicine ball  " } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onSelect).toHaveBeenCalledWith(["medicine ball"]);
    });

    it("does not add an empty or whitespace-only entry", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={[]} onSelect={onSelect} />);
      const input = screen.getByRole("textbox", { name: /add equipment/i });
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects a duplicate custom entry (case-insensitive)", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={["sled"]} onSelect={onSelect} />);
      const input = screen.getByRole("textbox", { name: /add equipment/i });
      fireEvent.change(input, { target: { value: "SLED" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("rejects a custom entry that duplicates a static option value", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={[]} onSelect={onSelect} />);
      const input = screen.getByRole("textbox", { name: /add equipment/i });
      // "barbell" is a static gym option value
      fireEvent.change(input, { target: { value: "Barbell" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onSelect).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("renders custom (non-static) selections as removable chips", () => {
      const onSelect = vi.fn();
      render(
        <EquipmentStep location="gym" value={["barbell", "sled"]} onSelect={onSelect} />,
      );
      // "sled" is not a static gym option → shown as a custom chip
      const remove = screen.getByRole("button", { name: /remove sled/i });
      expect(remove).toBeTruthy();
      fireEvent.click(remove);
      expect(onSelect).toHaveBeenCalledWith(["barbell"]);
    });

    it("clears the error once a valid entry is added", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={[]} onSelect={onSelect} />);
      const input = screen.getByRole("textbox", { name: /add equipment/i });
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
      expect(screen.getByRole("alert")).toBeTruthy();
      fireEvent.change(input, { target: { value: "sled" } });
      fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onSelect).toHaveBeenCalledWith(["sled"]);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("static option imagery", () => {
    it("renders the mapped OpenDesign photo on a card that has one", () => {
      render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
      const barbell = screen.getByRole("button", { name: /Barbell/i });
      const img = barbell.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toBe("/equipment/equip-barras.webp");
      expect(img!.getAttribute("loading")).toBe("lazy");
      // Alt text is an English literal (Option A — no i18n catalog keys).
      expect(img!.getAttribute("alt")).toMatch(/barbell/i);
    });

    it("maps dumbbells to the dumbbell photo", () => {
      render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
      const dumbbells = screen.getByRole("button", { name: /Dumbbells/i });
      const img = dumbbells.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toBe("/equipment/equip-mancuernas.webp");
    });

    it.each([
      ["Pull-up bar", "home", "/equipment/equip-dominadas.webp", /pull-up bar/i],
      ["Kettlebell", "home", "/equipment/equip-kettlebell.webp", /kettlebell/i],
      ["Bench", "home", "/equipment/equip-banco.webp", /bench/i],
      ["Leg press", "gym", "/equipment/equip-prensa.webp", /leg press/i],
      [
        "Suspension trainer",
        "outdoor",
        "/equipment/equip-trx.webp",
        /suspension trainer/i,
      ],
    ] as const)(
      "renders the mapped photo for %s",
      (label, location, src, altPattern) => {
        render(
          <EquipmentStep
            location={location as "home" | "gym" | "outdoor"}
            value={[]}
            onSelect={vi.fn()}
          />,
        );
        const card = screen.getByRole("button", { name: new RegExp(label, "i") });
        const img = card.querySelector("img");
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toBe(src);
        expect(img!.getAttribute("loading")).toBe("lazy");
        expect(img!.getAttribute("alt")).toMatch(altPattern);
      },
    );

    it("keeps smith_machine on the icon fallback (no mapped photo)", () => {
      // design verified none of the source images depict a Smith machine.
      render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
      const smith = screen.getByRole("button", { name: /Smith machine/i });
      expect(smith.querySelector("img")).toBeNull();
      // OrbitSelectableCard draws the check svg; the fallback icon adds another.
      expect(smith.querySelectorAll("svg").length).toBeGreaterThan(1);
    });

    it("keeps the data model unchanged — a photo card still toggles its value", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={[]} onSelect={onSelect} />);
      fireEvent.click(screen.getByRole("button", { name: /Barbell/i }));
      expect(onSelect).toHaveBeenCalledWith(["barbell"]);
    });
  });
});
