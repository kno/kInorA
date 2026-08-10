// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { createServerTranslator } from "@/test-utils/server-translator";
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
// `PlanWeekView` fetches the weekly overview server-side (Slice 4b) via a
// "use server" action — mocked here (no real cookies()/fetch in jsdom).
vi.mock("../actions", () => ({
  getWeeklyOverviewAction: vi.fn().mockResolvedValue({ kind: "error", message: "no_session" }),
}));
// PlanWeekView is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
  getLocale: async () => "en",
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

const twoSessionProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Push Day",
      exercises: [
        { name: "Bench Press", sets: 4, reps: "8-10", restSeconds: 90, notes: undefined },
        { name: "Overhead Press", sets: 3, reps: "10", restSeconds: 60, notes: undefined },
      ],
    },
    {
      day: 2,
      title: "Pull Day",
      exercises: [
        { name: "Barbell Row", sets: 4, reps: "8", restSeconds: 90, notes: undefined },
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
      { name: "Squat", sets: 3, reps: "8", restSeconds: 120, notes: undefined },
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
  // The plan name is the page's only level-1 heading (the cockpit hero, side
  // rail and week board use h2s), so we assert against role=heading level 1.
  it("renders the plan name as the page's level-1 heading when planName is provided", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Summer Cut",
      planId: "plan-x",
    });
    renderWithIntl(<>{view}</>);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Summer Cut");
  });

  it("renders a different plan name (triangulate)", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Winter Bulk",
      planId: "plan-x",
    });
    renderWithIntl(<>{view}</>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Winter Bulk");
  });

  it("omits the level-1 name heading when planName is absent", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);
    // Presentational h2s still exist, but no plan-name h1.
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("PlanWeekView — summary strip", () => {
  it("SC-01: session count tile shows the number of weeklySessions (2 sessions)", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const text = textOf(view);
    // The sessions count value should be "2"
    expect(text).toContain("2");
    expect(text).toContain("Planned sessions");
  });

  it("SC-01 triangulation: session count tile shows correct number for 5 sessions", async () => {
    const view = await PlanWeekView({ program: fiveSessionProgram, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("5");
    expect(text).toContain("Planned sessions");
  });

  it("SC-02: rest-days tile shows 7 − N (1 session → 6 rest days — value unique in tree)", async () => {
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
    const view = await PlanWeekView({ program: oneSessionProgram, planId: "plan-x" });
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

  it("SC-02 triangulation: rest-days tile shows 1 for 6 sessions (7 − 6 = 1 — unique value)", async () => {
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
    const view = await PlanWeekView({ program: sixSessionProgram, planId: "plan-x" });
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

  it("SC-03: estimated duration tile shows correct derived value (2 sessions = 21 min)", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("21");
    expect(text).toContain("Estimated duration");
  });

  it("SC-03 triangulation: duration for 5 sessions each with 1 squat (3×150s → 8min each, total 40 min)", async () => {
    const view = await PlanWeekView({ program: fiveSessionProgram, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("40");
    expect(text).toContain("Estimated duration");
  });

  it("SC-04: volume tile renders the — placeholder, not a real value", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("—");
    expect(text).toContain("Target volume");
  });
});

describe("PlanWeekView — limitation warning banner", () => {
  it("SC-16: banner renders cleaned limitation text + a single advisory line (issue #250)", async () => {
    // The generator emits the domain template (one localized advisory string per
    // limitation, each with the identical " — Consult…this area." tail). The
    // banner must show just the limitation TEXT per bullet and the advisory ONCE.
    const programWithWarnings: WorkoutProgram = {
      ...twoSessionProgram,
      limitationWarnings: [
        "Limitation: lower back pain — Consult a professional before attempting exercises that stress this area.",
        "Limitation: shoulder impingement — Consult a professional before attempting exercises that stress this area.",
      ],
    };
    const view = await PlanWeekView({ program: programWithWarnings, planId: "plan-x" });
    const text = textOf(view);
    expect(text).toContain("Important note");
    // Cleaned limitation text (prefix + advisory tail stripped, first char cap).
    expect(text).toContain("Lower back pain");
    expect(text).toContain("Shoulder impingement");
    // The repeated per-bullet advisory tail is gone…
    expect(text).not.toContain("stress this area");
    // …and the single advisory line appears exactly once.
    const advisory = "Consult a professional before attempting exercises that stress these areas.";
    expect(text).toContain(advisory);
    expect(text.split(advisory).length - 1).toBe(1);
  });

  it("SC-17: banner is absent when limitationWarnings is empty", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const text = textOf(view);
    // The limitation title should NOT appear when warnings array is empty
    expect(text).not.toContain("Important note");
  });
});

describe("PlanWeekView — interactive day grid + start CTA (#93 Slice 3)", () => {
  // Behavior-first: assert what the USER sees (a startable day grid rendered by
  // the wrapping client island), not the internal component identity. A rename
  // of the wrapper no longer silently breaks or passes these tests.
  it("SC-06: renders one interactive day card per session (2 sessions) with a working Start CTA", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    // Two day cards, addressable by their aria-label.
    expect(screen.getByRole("button", { name: "Day 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Day 2" })).toBeDefined();

    // The per-day Start CTA is wired (proves PlanTrackerClient passed
    // onStartWorkout down); it appears inside the detail panel once a day is
    // opened. Scoped to the panel because the hero renders its own Start CTA
    // (which starts the RECOMMENDED day, not the opened one).
    expect(document.getElementById("day-detail-panel")).toBeNull();
    // Addressed by the tile's aria-label: "Push Day" is now also the hero
    // title, since the hero describes the same session the plan recommends.
    fireEvent.click(screen.getByRole("button", { name: "Day 1" }));
    const panel = document.getElementById("day-detail-panel");
    expect(panel).not.toBeNull();
    expect(within(panel!).getByRole("button", { name: "Start session" })).toBeDefined();
  });

  it("SC-06 triangulation: renders one day card per session for a 5-session program", async () => {
    const view = await PlanWeekView({ program: fiveSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    for (const day of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole("button", { name: `Day ${day}` })).toBeDefined();
    }
  });

  it("spec-fidelity fix: renders a full 7-tile Monday-Sunday board, not just one card per training day (2-session program)", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    expect(screen.getAllByTestId("week-tile")).toHaveLength(7);
    // 2 interactive training-day tiles + 5 non-interactive rest tiles.
    expect(screen.getAllByRole("button", { name: /^Day \d+$/ })).toHaveLength(2);
  });
});

describe("PlanWeekView — archived-plan indicator (17d PR B)", () => {
  it("renders a visible archived badge when archivedAt is present", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Summer Cut",
      planId: "plan-x",
      archivedAt: "2026-08-01T00:00:00.000Z",
    });
    renderWithIntl(<>{view}</>);

    expect(screen.getByText(/archived/i)).toBeDefined();
  });

  it("renders no archived badge when archivedAt is absent (active plan)", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Summer Cut",
      planId: "plan-x",
    });
    renderWithIntl(<>{view}</>);

    expect(screen.queryByText(/archived/i)).toBeNull();
  });

  it("renders no archived badge when archivedAt is explicitly null", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Summer Cut",
      planId: "plan-x",
      archivedAt: null,
    });
    renderWithIntl(<>{view}</>);

    expect(screen.queryByText(/archived/i)).toBeNull();
  });

  it("the week view still renders normally (fully functional) for an archived plan — deep links stay live", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Summer Cut",
      planId: "plan-x",
      archivedAt: "2026-08-01T00:00:00.000Z",
    });
    renderWithIntl(<>{view}</>);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Summer Cut");
    expect(screen.getByRole("button", { name: "Day 1" })).toBeDefined();
  });
});

describe("PlanWeekView — trainer branding render (15b-v2 S4)", () => {
  // `--plan-accent` is a CSS custom property applied to a "use client"
  // descendant's DOM output (`PlanTrackerClient`'s root `.frame` div), which
  // is not yet materialized in the raw `view` element tree returned by the
  // (server) `PlanWeekView` — only realized once React actually renders it.
  // So we read it off the real DOM via `container`, not the element tree.
  function accentValue(container: HTMLElement): string {
    const frame = container.querySelector(".frame") as HTMLElement | null;
    return frame?.style.getPropertyValue("--plan-accent") ?? "";
  }

  it("renders trainer name, custom title, and sets --plan-accent when branding is present", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Summer Cut",
      planId: "plan-x",
      branding: { trainerName: "Coach Ana", title: "Ana's Summer Cut", accentColor: "#1E90FF" },
    });
    const { container } = renderWithIntl(<>{view}</>);

    // The custom title replaces the plain planName heading.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Ana's Summer Cut");
    // The trainer byline is rendered alongside it.
    expect(screen.getByText(/Coach Ana/)).toBeDefined();

    // The accent color reaches the DOM as a CSS custom property.
    expect(accentValue(container)).toBe("#1E90FF");
  });

  it("triangulation: a different accent color/title/trainerName render correctly", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planId: "plan-x",
      branding: { trainerName: "Coach Ben", title: "Winter Strength", accentColor: "#FF4500" },
    });
    const { container } = renderWithIntl(<>{view}</>);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Winter Strength");
    expect(screen.getByText(/Coach Ben/)).toBeDefined();

    expect(accentValue(container)).toBe("#FF4500");
  });

  it("renders the base plan unchanged (no --plan-accent, no branding byline) when branding is absent", async () => {
    const view = await PlanWeekView({
      program: twoSessionProgram,
      planName: "Summer Cut",
      planId: "plan-x",
    });
    const { container } = renderWithIntl(<>{view}</>);

    // planName still renders verbatim as the h1 (base fallback behavior).
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Summer Cut");
    // No trainer byline, and no --plan-accent custom property in the DOM.
    expect(container.querySelector(".brandingByline")).toBeNull();
    expect(accentValue(container)).toBe("");
  });
});

describe("PlanWeekView — the route renders real data, not mockup copy (kno/kInorA#411, #420)", () => {
  // The hero used to render literal catalog strings ("Today · Fri 12",
  // "68 min", "6 exercises", "Upper-body strength") as if they were the user's
  // data. Each assertion below is triangulated against a SECOND fixture, so a
  // regression to any hardcoded string fails rather than coincidentally passing.
  //
  // #420 extended this guard past the hero to the whole data-wired route: the
  // side rail's fabricated readiness/biometric figures and its AI-coach
  // prescriptions were the same defect with higher stakes, so they are checked
  // here rather than in a second guard that could drift from this one.

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Freeze only `Date` — the component under test is awaited, so timers must keep working. */
  function freezeClock(iso: string): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  }

  it("the date pill follows a frozen clock", async () => {
    freezeClock("2026-08-09T10:00:00Z"); // Sunday
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    expect(screen.getByText("Today · Sunday, August 9")).toBeDefined();
    // The mockup string that shipped to production must be gone.
    expect(screen.queryByText(/Fri 12/)).toBeNull();
  });

  it("the date pill follows the clock to a different day (triangulation)", async () => {
    freezeClock("2026-12-25T10:00:00Z"); // Friday
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    expect(screen.getByText("Today · Friday, December 25")).toBeDefined();
  });

  it("the hero title is the recommended session's real title", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    // No weekly overview (mocked to error) → recommended is the first session.
    expect(screen.getByRole("heading", { level: 2, name: "Push Day" })).toBeDefined();
    expect(screen.queryByText("Upper-body strength")).toBeNull();
  });

  it("the hero title triangulates to a different program's first session", async () => {
    const view = await PlanWeekView({ program: fiveSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    expect(screen.getByRole("heading", { level: 2, name: "Day 1 session" })).toBeDefined();
  });

  it("the meta pills carry the recommended session's real duration and exercise count", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    // "Push Day": Bench 4×(90+30) + OHP 3×(60+30) = 750s → 13 min, 2 exercises.
    expect(screen.getByText("13 min")).toBeDefined();
    expect(screen.getByText("2 exercises")).toBeDefined();
    expect(screen.queryByText("68 min")).toBeNull();
    expect(screen.queryByText("6 exercises")).toBeNull();
  });

  it("the meta pills triangulate on a different program, and the count is pluralized", async () => {
    const view = await PlanWeekView({ program: fiveSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    // "Day 1 session": Squat 3×(120+30) = 450s → 8 min, 1 exercise (singular).
    expect(screen.getByText("8 min")).toBeDefined();
    expect(screen.getByText("1 exercise")).toBeDefined();
  });

  it("says so plainly when the program has no sessions, instead of inventing one", async () => {
    const view = await PlanWeekView({
      program: { weeklySessions: [], limitationWarnings: [] },
      planId: "plan-x",
    });
    renderWithIntl(<>{view}</>);

    expect(screen.getByRole("heading", { level: 2, name: "No session planned" })).toBeDefined();
    // No invented duration/exercise pills alongside the real metrics grid.
    expect(screen.queryByText(/\bmin$/)).toBeNull();
  });

  it("renders no control that claims an action it cannot perform", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    renderWithIntl(<>{view}</>);

    for (const gone of ["Move to Saturday", "Rebalance week"]) {
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
      expect(screen.queryByText(gone)).toBeNull();
    }
    // The muscle body-map asserted a focus the plan never supplied.
    expect(screen.queryByText("Push active")).toBeNull();
    expect(screen.queryByText("Chest · shoulders · triceps")).toBeNull();
  });

  it("keeps 'Edit plan' — the one topbar action that is real", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const { container } = renderWithIntl(<>{view}</>);

    const edit = container.querySelector('a[href="/create-plan"]');
    expect(edit?.textContent).toBe("Edit plan");
  });

  // --- #420: the side rail's fabricated health data and coaching ---

  it("renders no readiness score, and no sleep / soreness / last-push figure", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const { container } = renderWithIntl(<>{view}</>);

    // The app takes none of these measurements, so none of their labels,
    // values or the ring that framed them may reach the DOM.
    for (const gone of [
      "Readiness",
      "Ready to push, not to improvise.",
      "Sleep",
      "7h 35m",
      "Muscle soreness",
      "Last push",
      "96 h",
      "Recommendation",
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    // The `82` was a literal in JSX, and its aria-label offered it to a screen
    // reader as a measured percentage — the most quietly harmful part of all.
    expect(container.textContent).not.toContain("82");
    expect(screen.queryByRole("img", { name: /Readiness/i })).toBeNull();
  });

  it("renders no training prescription — no weight, set or RPE advice from static copy", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const { container } = renderWithIntl(<>{view}</>);

    for (const gone of [
      "Add 2.5 kg",
      "82.5 kg",
      "Keep bench at 82.5 kg",
      "RPE 7–8",
      "Coach AI",
      "Suggested adjustments",
      "+2.5 kg if it's clean",
    ]) {
      expect(container.textContent).not.toContain(gone);
    }
  });

  it("renders no control that reports applying a change to the plan", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const { container } = renderWithIntl(<>{view}</>);

    for (const gone of ["Adjust fatigue", "Prepare progression"]) {
      expect(screen.queryByRole("button", { name: new RegExp(gone) })).toBeNull();
    }
    // Neither the toast those buttons raised nor the note they swapped in.
    expect(container.textContent).not.toContain("Suggestion applied to your plan");
    expect(container.textContent).not.toContain("accessories reduced");
  });

  it("shows today's exercises only from the real session, never a second invented list", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const { container } = renderWithIntl(<>{view}</>);

    // The six mockup exercises stood beside the hero's REAL session and
    // disagreed with it. The real ones are the fixture's.
    for (const invented of [
      "Flat bench press",
      "Barbell row",
      "Overhead press",
      "Weighted pull-ups",
      "Barbell curl",
      "Triceps pushdown",
    ]) {
      expect(container.textContent).not.toContain(invented);
    }
    expect(screen.getByRole("heading", { level: 2, name: "Push Day" })).toBeDefined();
  });

  it("the eyebrow and the metrics group describe only what the plan supplies", async () => {
    const view = await PlanWeekView({ program: twoSessionProgram, planId: "plan-x" });
    const { container } = renderWithIntl(<>{view}</>);

    // "Weekly control · strength block" asserted a block type no plan carries.
    expect(container.textContent).not.toContain("strength block");
    expect(screen.getByText("Weekly control")).toBeDefined();
    // The metrics grid is sessions / rest / duration / volume — labelling it
    // "Muscle focus" was left over from the body-map removed in #411.
    expect(container.querySelector('[aria-label="Muscle focus"]')).toBeNull();
    expect(container.querySelector('[aria-label="Plan summary"]')).not.toBeNull();
  });
});
