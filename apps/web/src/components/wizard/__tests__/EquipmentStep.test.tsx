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

    it("maps smith_machine to the gym (Smith machine) photo", () => {
      render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
      const smith = screen.getByRole("button", { name: /Smith machine/i });
      const img = smith.querySelector("img");
      expect(img).not.toBeNull();
      expect(img!.getAttribute("src")).toBe("/equipment/equip-gimnasio.webp");
      expect(img!.getAttribute("loading")).toBe("lazy");
      expect(img!.getAttribute("alt")).toMatch(/smith machine/i);
    });

    it("keeps the data model unchanged — a photo card still toggles its value", () => {
      const onSelect = vi.fn();
      render(<EquipmentStep location="gym" value={[]} onSelect={onSelect} />);
      fireEvent.click(screen.getByRole("button", { name: /Barbell/i }));
      expect(onSelect).toHaveBeenCalledWith(["barbell"]);
    });

    it("uses the full-bleed media treatment: no checkmark on a photo card", () => {
      // The media card omits the check indicator; its only SVG-free content is
      // the image + the overprinted label. The check <path d="M5 13l4 4L19 7">
      // must NOT be present.
      render(<EquipmentStep location="gym" value={["barbell"]} onSelect={vi.fn()} />);
      const barbell = screen.getByRole("button", { name: /Barbell/i });
      expect(barbell.querySelector("img")).not.toBeNull();
      expect(barbell.querySelector('path[d="M5 13l4 4L19 7"]')).toBeNull();
    });

    it("conveys selection via aria-pressed (not a checkmark) on a photo card", () => {
      render(<EquipmentStep location="gym" value={["barbell"]} onSelect={vi.fn()} />);
      const barbell = screen.getByRole("button", { name: /Barbell/i });
      expect(barbell.getAttribute("aria-pressed")).toBe("true");
      const dumbbells = screen.getByRole("button", { name: /Dumbbells/i });
      expect(dumbbells.getAttribute("aria-pressed")).toBe("false");
    });

    it("exposes an accessible name equal to the equipment label", () => {
      render(<EquipmentStep location="gym" value={[]} onSelect={vi.fn()} />);
      // getByRole by name resolves only because the overprinted label is real,
      // visible text — screen readers read it as the button's name.
      expect(screen.getByRole("button", { name: "Barbell" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Smith machine" })).toBeTruthy();
    });
  });
});
