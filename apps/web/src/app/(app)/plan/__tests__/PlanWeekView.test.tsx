// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type { WorkoutProgram } from "@kinora/contracts";

// Rendering PlanWeekView exercises its child PlanTrackerClient, which imports
// the "use server" actions and a CSS module — both must be neutralised in jsdom.
vi.mock("../plan-week-view.module.css", () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock("../[id]/actions", () => ({
  startWorkoutSessionAction: vi.fn(),
  recordWorkoutSetAction: vi.fn(),
  completeWorkoutSessionAction: vi.fn(),
}));

// --- React tree inspection helpers ---

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement | undefined {
  if (typeof node === "object" && node !== null && "props" in node) {
    const el = node as AnyElement;
    if (match(el)) return el;
    const found = findFirst(el.props.children, match);
    if (found) return found;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFirst(child, match);
      if (found) return found;
    }
  }
  return undefined;
}

function findAll(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement[] {
  const results: AnyElement[] = [];
  function walk(n: ReactNode): void {
    if (typeof n === "object" && n !== null && "props" in n) {
      const el = n as AnyElement;
      if (match(el)) results.push(el);
      walk(el.props.children);
    }
    if (Array.isArray(n)) n.forEach(walk);
  }
  walk(node);
  return results;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return textOf((node as AnyElement).props.children);
  }
  return "";
}

// --- Import component under test ---
import { PlanWeekView } from "../PlanWeekView";

// --- Test fixtures ---

const messages: Record<string, string> = {
  plan_summary_sessions: "Planned sessions",
  plan_summary_sessions_sub: "training days",
  plan_summary_rest: "Rest days",
  plan_summary_rest_sub: "per week",
  plan_summary_duration: "Estimated duration",
  plan_summary_duration_sub: "per week (est.)",
  plan_summary_volume: "Target volume",
  plan_summary_volume_sub: "coming soon",
  plan_summary_volume_placeholder: "—",
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
};

const twoSessionProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Push Day",
      exercises: [
        { name: "Bench Press", sets: 4, reps: "8-10", restSeconds: 90, notes: undefined, substitutionNote: undefined },
        { name: "Overhead Press", sets: 3, reps: "10", restSeconds: 60, notes: undefined, substitutionNote: undefined },
      ],
    },
    {
      day: 2,
      title: "Pull Day",
      exercises: [
        { name: "Barbell Row", sets: 4, reps: "8", restSeconds: 90, notes: undefined, substitutionNote: undefined },
      ],
    },
  ],
  limitationWarnings: [],
};

const fiveSessionProgram: WorkoutProgram = {
  weeklySessions: [1, 2, 3, 4, 5].map((day) => ({
    day,
    title: `Day ${day} session`,
    exercises: [
      { name: "Squat", sets: 3, reps: "8", restSeconds: 120, notes: undefined, substitutionNote: undefined },
    ],
  })),
  limitationWarnings: [],
};

// Verify duration formula:
// twoSessionProgram session1: 2 exercises
//   Bench Press: 4 sets × (90 + 30) = 480s
//   Overhead Press: 3 sets × (60 + 30) = 270s
//   total = 750s → ceil(750/60) = 13 min
// session2:
//   Barbell Row: 4 sets × (90 + 30) = 480s
//   total = 480s → ceil(480/60) = 8 min
// Total across sessions = 13 + 8 = 21 min

// fiveSessionProgram each session:
//   Squat: 3 sets × (120 + 30) = 450s → ceil(450/60) = 8 min
// Total = 5 × 8 = 40 min

// --- Tests ---

describe("PlanWeekView — plan name header (#93)", () => {
  it("renders the plan name in a heading when planName is provided", () => {
    const view = PlanWeekView({
      program: twoSessionProgram,
      messages,
      planName: "Summer Cut",
      planId: "plan-x",
    });
    const heading = findFirst(view, (el) => el.type === "h1" || el.type === "h2");
    expect(heading).toBeDefined();
    expect(textOf(heading)).toContain("Summer Cut");
  });

  it("renders a different plan name (triangulate)", () => {
    const view = PlanWeekView({
      program: twoSessionProgram,
      messages,
      planName: "Winter Bulk",
      planId: "plan-x",
    });
    expect(textOf(view)).toContain("Winter Bulk");
  });

  it("omits the name heading when planName is absent", () => {
    const view = PlanWeekView({ program: twoSessionProgram, messages, planId: "plan-x" });
    const heading = findFirst(view, (el) => el.type === "h1" || el.type === "h2");
    expect(heading).toBeUndefined();
  });
});

describe("PlanWeekView — summary strip", () => {
  it("SC-01: session count tile shows the number of weeklySessions (2 sessions)", () => {
    const view = PlanWeekView({ program: twoSessionProgram, messages, planId: "plan-x" });
    const text = textOf(view);
    // The sessions count value should be "2"
    expect(text).toContain("2");
    expect(text).toContain("Planned sessions");
  });

  it("SC-01 triangulation: session count tile shows correct number for 5 sessions", () => {
    const view = PlanWeekView({ program: fiveSessionProgram, messages, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("5");
    expect(text).toContain("Planned sessions");
  });

  it("SC-02: rest-days tile shows 7 − N (1 session → 6 rest days — value unique in tree)", () => {
    // Use 1 session → 6 rest days: the value "6" is unique in the rendered tree
    // (there are no exercises with 6 sets and no session day numbered 6),
    // so the assertion is unambiguous.
    const oneSessionProgram: WorkoutProgram = {
      weeklySessions: [
        {
          day: 1,
          title: "Single Day",
          exercises: [{ name: "Pushup", sets: 3, reps: "15", restSeconds: 30 }],
        },
      ],
      limitationWarnings: [],
    };
    const view = PlanWeekView({ program: oneSessionProgram, messages, planId: "plan-x" });
    // Find the summary tile that contains "Rest days" label
    const restTile = findFirst(
      view,
      (el) =>
        typeof el.type === "string" &&
        textOf(el).includes("Rest days") &&
        textOf(el).includes("per week"),
    );
    expect(restTile).toBeDefined();
    // The tile text contains the value "6" (7 − 1 = 6)
    const tileText = textOf(restTile!);
    expect(tileText).toContain("6");
    // Confirm "Rest days" label is present in the same tile
    expect(tileText).toContain("Rest days");
  });

  it("SC-02 triangulation: rest-days tile shows 1 for 6 sessions (7 − 6 = 1 — unique value)", () => {
    // 6 sessions → 1 rest day: "1" as a rest-day value is unique
    // (session days are 1–6, but we inspect only the rest-tile node).
    const sixSessionProgram: WorkoutProgram = {
      weeklySessions: Array.from({ length: 6 }, (_, i) => ({
        day: i + 1,
        title: `Day ${i + 1}`,
        exercises: [{ name: "Run", sets: 1, reps: "20 min", restSeconds: 0 }],
      })),
      limitationWarnings: [],
    };
    const view = PlanWeekView({ program: sixSessionProgram, messages, planId: "plan-x" });
    const restTile = findFirst(
      view,
      (el) =>
        typeof el.type === "string" &&
        textOf(el).includes("Rest days") &&
        textOf(el).includes("per week"),
    );
    expect(restTile).toBeDefined();
    const tileText = textOf(restTile!);
    // The value "1" appears in the rest tile (7 − 6 = 1)
    expect(tileText).toContain("1");
    expect(tileText).toContain("Rest days");
  });

  it("SC-03: estimated duration tile shows correct derived value (2 sessions = 21 min)", () => {
    const view = PlanWeekView({ program: twoSessionProgram, messages, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("21");
    expect(text).toContain("Estimated duration");
  });

  it("SC-03 triangulation: duration for 5 sessions each with 1 squat (3×150s → 8min each, total 40 min)", () => {
    const view = PlanWeekView({ program: fiveSessionProgram, messages, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("40");
    expect(text).toContain("Estimated duration");
  });

  it("SC-04: volume tile renders the — placeholder, not a real value", () => {
    const view = PlanWeekView({ program: twoSessionProgram, messages, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("—");
    expect(text).toContain("Target volume");
  });
});

describe("PlanWeekView — limitation warning banner", () => {
  it("SC-16: banner renders when limitationWarnings has entries", () => {
    const programWithWarnings: WorkoutProgram = {
      ...twoSessionProgram,
      limitationWarnings: ["Avoid overhead movements", "Limit knee flexion"],
    };
    const view = PlanWeekView({ program: programWithWarnings, messages, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("Important note");
    expect(text).toContain("Avoid overhead movements");
    expect(text).toContain("Limit knee flexion");
  });

  it("SC-17: banner is absent when limitationWarnings is empty", () => {
    const view = PlanWeekView({ program: twoSessionProgram, messages, planId: "plan-x" });
    const text = textOf(view);
    // The limitation title should NOT appear when warnings array is empty
    expect(text).not.toContain("Important note");
  });
});

describe("PlanWeekView — interactive day grid + start CTA (#93 Slice 3)", () => {
  // Behavior-first: assert what the USER sees (a startable day grid rendered by
  // the wrapping client island), not the internal component identity. A rename
  // of the wrapper no longer silently breaks or passes these tests.
  it("SC-06: renders one interactive day card per session (2 sessions) with a working Start CTA", () => {
    render(
      <>{PlanWeekView({ program: twoSessionProgram, messages, planId: "plan-x" })}</>,
    );

    // Two day cards, addressable by their aria-label.
    expect(screen.getByRole("button", { name: "Day 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Day 2" })).toBeDefined();

    // The per-day Start CTA is wired (proves PlanTrackerClient passed
    // onStartWorkout down); it appears once a day is opened.
    expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();
    fireEvent.click(screen.getByText("Push Day"));
    expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
  });

  it("SC-06 triangulation: renders one day card per session for a 5-session program", () => {
    render(
      <>{PlanWeekView({ program: fiveSessionProgram, messages, planId: "plan-x" })}</>,
    );

    for (const day of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole("button", { name: `Day ${day}` })).toBeDefined();
    }
  });
});
