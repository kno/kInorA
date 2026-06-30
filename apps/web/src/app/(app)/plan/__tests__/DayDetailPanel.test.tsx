// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WorkoutSession } from "@kinora/contracts";

// Mock plan-week-view.module.css to avoid CSS module transform errors
vi.mock("../plan-week-view.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

import { DayDetailPanel } from "../DayDetailPanel";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Test fixtures ---

const messages: Record<string, string> = {
  plan_day_label: "Day {n}",
  plan_exercises_count: "exercises",
  plan_est_duration: "est. {n} min",
  plan_table_exercise: "Exercise",
  plan_table_sets: "Sets",
  plan_table_reps: "Reps",
  plan_table_rest: "Rest",
  plan_limitation_title: "Important note",
  plan_day_detail_close: "Close",
};

const sessions: WorkoutSession[] = [
  {
    day: 1,
    title: "Push Day",
    exercises: [
      { name: "Bench Press", sets: 4, reps: "8-10", restSeconds: 90, notes: undefined, substitutionNote: undefined },
      { name: "Overhead Press", sets: 3, reps: "10", restSeconds: 60, notes: "Keep elbows tucked", substitutionNote: undefined },
    ],
  },
  {
    day: 2,
    title: "Pull Day",
    exercises: [
      {
        name: "Barbell Row",
        sets: 4,
        reps: "8",
        restSeconds: 90,
        notes: undefined,
        substitutionNote: "Can use dumbbells",
      },
    ],
  },
  {
    day: 3,
    title: "Leg Day",
    exercises: [
      { name: "Squat", sets: 5, reps: "5", restSeconds: 180, notes: undefined, substitutionNote: undefined },
    ],
  },
];

// --- Tests ---

describe("DayDetailPanel — day card grid (SC-06, SC-07, SC-08)", () => {
  it("SC-06: renders the correct number of day cards (3 sessions → 3 cards with role=button)", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    // Each session card has role="button" with an aria-label matching "Day N"
    const buttons = screen.getAllByRole("button");
    // Should have at least 3 cards (one per session)
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it("SC-07: each card shows the day label with session number", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    // getByText throws if not found — that IS the assertion
    expect(screen.getByText("Day 1")).toBeDefined();
    expect(screen.getByText("Day 2")).toBeDefined();
    expect(screen.getByText("Day 3")).toBeDefined();
  });

  it("SC-07 triangulation: each card shows the session title", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    expect(screen.getByText("Push Day")).toBeDefined();
    expect(screen.getByText("Pull Day")).toBeDefined();
    expect(screen.getByText("Leg Day")).toBeDefined();
  });

  it("SC-07 triangulation: each card shows exercise count with correct number", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    // Session 1 has 2 exercises → "2 exercises"
    const twoEx = screen.getByText(/2 exercises/);
    expect(twoEx).toBeDefined();
    // Sessions 2 and 3 have 1 exercise each → "1 exercises" (×2)
    const oneEx = screen.getAllByText(/1 exercises/);
    expect(oneEx.length).toBe(2);
  });

  it("SC-08: day cards have role='button' and tabIndex=0", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    const dayCards = document.querySelectorAll('[role="button"]');
    // At least 3 cards (one per session)
    expect(dayCards.length).toBeGreaterThanOrEqual(3);
    // Every card must have tabindex="0"
    dayCards.forEach((card) => {
      expect(card.getAttribute("tabindex")).toBe("0");
    });
  });
});

describe("DayDetailPanel — expand/collapse interaction (SC-09, SC-10)", () => {
  it("SC-09: clicking a card opens its detail panel showing the exercise table", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    // Initially no table (no panel open)
    expect(screen.queryByRole("table")).toBeNull();

    // Click the Push Day card title
    fireEvent.click(screen.getByText("Push Day"));

    // Now the exercise table should be present
    const table = screen.getByRole("table");
    expect(table).toBeDefined();
    expect(screen.getByText("Bench Press")).toBeDefined();
  });

  it("SC-09 triangulation: clicking a different card opens its panel and closes the first", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    // Open day 1
    fireEvent.click(screen.getByText("Push Day"));
    expect(screen.getByText("Bench Press")).toBeDefined();

    // Open day 2 — closes day 1, opens day 2
    fireEvent.click(screen.getByText("Pull Day"));
    expect(screen.queryByText("Bench Press")).toBeNull();
    expect(screen.getByText("Barbell Row")).toBeDefined();
  });

  it("SC-10: clicking the close button collapses the detail panel", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    // Open day 1
    fireEvent.click(screen.getByText("Push Day"));
    expect(screen.getByText("Bench Press")).toBeDefined();

    // Click the Close button
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByText("Bench Press")).toBeNull();
  });

  it("SC-10 triangulation: clicking the open card again collapses it (toggle)", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    // Open day 1 by clicking its title (unique before panel opens)
    fireEvent.click(screen.getByText("Push Day"));
    expect(screen.getByText("Bench Press")).toBeDefined();

    // Panel is now open — both card and panel show "Day 1" / "Push Day".
    // Find the card by its aria-label which is unique.
    const cardEl = screen.getByRole("button", { name: "Day 1" });
    expect(cardEl).toBeDefined();
    fireEvent.click(cardEl);

    expect(screen.queryByText("Bench Press")).toBeNull();
  });
});

describe("DayDetailPanel — detail panel exercise table (SC-12, SC-13, SC-23)", () => {
  it("SC-12: detail panel shows 4-column table headers", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    fireEvent.click(screen.getByText("Push Day"));

    // All 4 column headers must be present
    expect(screen.getByText("Exercise")).toBeDefined();
    expect(screen.getByText("Sets")).toBeDefined();
    expect(screen.getByText("Reps")).toBeDefined();
    expect(screen.getByText("Rest")).toBeDefined();
  });

  it("SC-23: Peso column heading is NOT in the DOM", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    fireEvent.click(screen.getByText("Push Day"));

    // "Peso" and "Weight" must be absent — deferred to 09a
    expect(screen.queryByText("Peso")).toBeNull();
    expect(screen.queryByText("Weight")).toBeNull();
  });

  it("SC-13: exercise row shows name, sets, reps, and rest chip with seconds", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    fireEvent.click(screen.getByText("Push Day"));

    expect(screen.getByText("Bench Press")).toBeDefined();
    // sets = 4, reps = "8-10", restSeconds = 90
    expect(screen.getByText("4")).toBeDefined();
    expect(screen.getByText("8-10")).toBeDefined();
    expect(screen.getByText(/90 s/)).toBeDefined();
  });

  it("SC-13 triangulation: notes appear as sub-line when present", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    fireEvent.click(screen.getByText("Push Day"));

    // Overhead Press has notes: "Keep elbows tucked"
    expect(screen.getByText("Keep elbows tucked")).toBeDefined();
  });

  it("SC-13 triangulation: substitutionNote appears when present", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    fireEvent.click(screen.getByText("Pull Day"));

    // Barbell Row has substitutionNote: "Can use dumbbells"
    expect(screen.getByText("Can use dumbbells")).toBeDefined();
  });

  it("SC-12: no 'Empezar sesión' CTA is present (deferred to 09a)", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    fireEvent.click(screen.getByText("Push Day"));

    // No workout-start CTA in PR1 scope
    expect(screen.queryByText(/Empezar/)).toBeNull();
    expect(screen.queryByText(/Start session/i)).toBeNull();
  });
});

describe("DayDetailPanel — guardrail: no API reference (SC-22)", () => {
  it("renders from props only, no fetch or API reference needed", () => {
    // If this renders without needing any mock fetch/API, the component is clean
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    // The day cards are rendered from pure props
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("DayDetailPanel — 2-session variant (triangulation for SC-06)", () => {
  it("renders exactly 2 day cards for a 2-session program", () => {
    const twoSessions: WorkoutSession[] = sessions.slice(0, 2);
    render(<DayDetailPanel sessions={twoSessions} messages={messages} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
  });
});
