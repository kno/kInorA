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
  plan_day_start_cta: "Start session",
  plan_start_conflict: "You have an active session for {plan} · Day {n}.",
  plan_start_conflict_no_day: "You have an active session for {plan}.",
  plan_start_conflict_generic: "You already have an active workout session.",
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

  it("SC-07: card meta line joins count and duration with the '·' separator", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    // Assert the exact composed meta text (count · est. N min) so a broken
    // separator or ordering fails loudly instead of passing on a partial match.
    // Session 1: 2 exercises; Bench Press 4×(90+30)=480 + Overhead 3×(60+30)=270
    //   = 750s → ceil(750/60) = 13 min.
    const meta = screen.getByText(/2 exercises · est\. 13 min/);
    expect(meta).toBeDefined();
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

describe("DayDetailPanel — aria-controls (Fix 3 / SC-08)", () => {
  it("active card has aria-controls pointing to the detail panel id", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    // Before clicking — no card should have aria-controls
    const day1Card = screen.getByRole("button", { name: "Day 1" });
    expect(day1Card.getAttribute("aria-controls")).toBeNull();

    // Open the panel
    fireEvent.click(day1Card);

    // Now the active card should have aria-controls="day-detail-panel"
    expect(day1Card.getAttribute("aria-controls")).toBe("day-detail-panel");

    // And the detail panel element should have that id
    const panel = document.getElementById("day-detail-panel");
    expect(panel).not.toBeNull();
  });

  it("inactive cards have no aria-controls; only the active card does", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    fireEvent.click(screen.getByRole("button", { name: "Day 2" }));

    // Day 2 card (active) has aria-controls
    const day2Card = screen.getByRole("button", { name: "Day 2" });
    expect(day2Card.getAttribute("aria-controls")).toBe("day-detail-panel");

    // Day 1 card (inactive) does NOT
    const day1Card = screen.getByRole("button", { name: "Day 1" });
    expect(day1Card.getAttribute("aria-controls")).toBeNull();
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

describe("DayDetailPanel — keyboard interaction (SC-08, Fix 6)", () => {
  it("Enter key on a day-card opens its detail panel", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    // Initially no detail panel
    expect(screen.queryByRole("table")).toBeNull();

    // Fire Enter on the Push Day card
    const pushDayCard = screen.getByRole("button", { name: "Day 1" });
    fireEvent.keyDown(pushDayCard, { key: "Enter" });

    // Detail panel should open showing the exercise table
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("Bench Press")).toBeDefined();
  });

  it("Space key on a day-card opens its detail panel", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    expect(screen.queryByRole("table")).toBeNull();

    // Fire Space on Day 2 (Pull Day)
    const pullDayCard = screen.getByRole("button", { name: "Day 2" });
    fireEvent.keyDown(pullDayCard, { key: " " });

    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("Barbell Row")).toBeDefined();
  });

  it("Enter key on open card closes it (toggle via keyboard)", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);

    // Open Day 1 via keyboard
    const pushDayCard = screen.getByRole("button", { name: "Day 1" });
    fireEvent.keyDown(pushDayCard, { key: "Enter" });
    expect(screen.getByText("Bench Press")).toBeDefined();

    // Press Enter again to close (toggle)
    fireEvent.keyDown(pushDayCard, { key: "Enter" });
    expect(screen.queryByText("Bench Press")).toBeNull();
  });
});

describe("DayDetailPanel — per-day Start CTA (#93 Slice 3)", () => {
  it("renders a Start session CTA inside the open detail panel when onStartWorkout is provided", () => {
    const onStartWorkout = vi.fn();
    render(
      <DayDetailPanel
        sessions={sessions}
        messages={messages}
        onStartWorkout={onStartWorkout}
      />,
    );

    // No CTA before a day is opened.
    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();

    // Open Day 1.
    fireEvent.click(screen.getByText("Push Day"));

    const cta = screen.getByRole("button", { name: "Start session" });
    expect(cta).toBeDefined();
  });

  it("clicking the Start CTA invokes onStartWorkout with the selected day", () => {
    const onStartWorkout = vi.fn();
    render(
      <DayDetailPanel
        sessions={sessions}
        messages={messages}
        onStartWorkout={onStartWorkout}
      />,
    );

    fireEvent.click(screen.getByText("Pull Day")); // day 2
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    expect(onStartWorkout).toHaveBeenCalledTimes(1);
    expect(onStartWorkout).toHaveBeenCalledWith(2);
  });

  it("does NOT render the Start CTA when onStartWorkout is absent (legacy /plan/[id] callers)", () => {
    render(<DayDetailPanel sessions={sessions} messages={messages} />);
    fireEvent.click(screen.getByText("Push Day"));
    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
  });
});

describe("DayDetailPanel — conflict banner (#93 Slice 3)", () => {
  it("renders a localized conflict banner naming the active plan and day when conflict is set", () => {
    render(
      <DayDetailPanel
        sessions={sessions}
        messages={messages}
        onStartWorkout={vi.fn()}
        conflict={{ activePlanName: "Summer Block", activeDay: 3 }}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Summer Block");
    expect(banner.textContent).toContain("3");
  });

  it("renders a no-day conflict variant when activeDay is null", () => {
    render(
      <DayDetailPanel
        sessions={sessions}
        messages={messages}
        onStartWorkout={vi.fn()}
        conflict={{ activePlanName: "Summer Block", activeDay: null }}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Summer Block");
    // The no-day variant has no "· Day" segment.
    expect(banner.textContent).not.toContain("· Day");
  });

  it("renders a generic conflict banner when the active plan name is unknown", () => {
    render(
      <DayDetailPanel
        sessions={sessions}
        messages={messages}
        onStartWorkout={vi.fn()}
        conflict={{ activeDay: null }}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toBe("You already have an active workout session.");
  });

  it("renders no conflict banner when conflict is undefined", () => {
    render(
      <DayDetailPanel
        sessions={sessions}
        messages={messages}
        onStartWorkout={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
