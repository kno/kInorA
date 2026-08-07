import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkoutHistoryEntry } from "@kinora/contracts";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

const getWorkoutHistoryAction = vi.fn();

// HistoryPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

vi.mock("../actions.js", () => ({
  getWorkoutHistoryAction: (...args: unknown[]) => getWorkoutHistoryAction(...args),
}));

import HistoryPage from "../page";
import { createServerTranslator } from "@/test-utils/server-translator";

const historyEntry: WorkoutHistoryEntry = {
  session: {
    id: "session-1",
    workoutPlanId: "plan-1",
    status: "completed",
    startedAt: "2026-07-04T08:00:00.000Z",
    completedAt: "2026-07-04T09:00:00.000Z",
    exercises: [
      {
        id: "exercise-1",
        workoutSessionId: "session-1",
        exerciseIndex: 0,
        title: "Bench Press",
        restSeconds: 90,
        setRecords: [],
      },
    ],
  },
  totalVolume: 100,
  averageRpe: 8,
  trend: { volumeDelta: 20, direction: "up" },
};

// 17b-stale-session-recovery PR 3: an abandoned session appears in history
// alongside its logged sets — terminal there (no resume/log/complete
// action), with no duration line (no `completedAt`) and an explicit label.
const abandonedEntry: WorkoutHistoryEntry = {
  session: {
    id: "session-abandoned-1",
    workoutPlanId: "plan-1",
    status: "abandoned",
    startedAt: "2026-07-05T08:00:00.000Z",
    exercises: [
      {
        id: "exercise-2",
        workoutSessionId: "session-abandoned-1",
        exerciseIndex: 0,
        title: "Squat",
        restSeconds: 90,
        setRecords: [],
      },
    ],
  },
  totalVolume: 50,
  trend: undefined,
};

describe("HistoryPage", () => {
  it("is sync-independent — renders history without touching any offline queue/snapshot module", async () => {
    getWorkoutHistoryAction.mockResolvedValue({ kind: "ok", entries: [historyEntry] });

    const page = await HistoryPage({ searchParams: Promise.resolve({}) });

    expect(getWorkoutHistoryAction).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(textOf(page)).toContain("100");
  });

  it("renders the empty state when there are no completed sessions", async () => {
    getWorkoutHistoryAction.mockResolvedValue({ kind: "ok", entries: [] });

    const page = await HistoryPage({ searchParams: Promise.resolve({}) });

    expect(textOf(page)).toContain("No completed sessions yet.");
  });

  it("falls back to an empty list when the action errors (fail-open, matches listPlansAction pattern)", async () => {
    getWorkoutHistoryAction.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await HistoryPage({ searchParams: Promise.resolve({}) });

    expect(textOf(page)).toContain("No completed sessions yet.");
  });

  it("renders duration and average RPE for a completed session", async () => {
    getWorkoutHistoryAction.mockResolvedValue({ kind: "ok", entries: [historyEntry] });

    const page = await HistoryPage({ searchParams: Promise.resolve({}) });
    const text = textOf(page);

    expect(text).toContain("60 min");
    expect(text).toContain("8");
  });

  it("forwards the offset query param to the action for pagination", async () => {
    getWorkoutHistoryAction.mockResolvedValue({ kind: "ok", entries: [] });

    await HistoryPage({ searchParams: Promise.resolve({ offset: "20" }) });

    expect(getWorkoutHistoryAction).toHaveBeenCalledWith({ limit: 20, offset: 20 });
  });

  it("renders the abandoned label and suppresses the duration line for an abandoned session", async () => {
    getWorkoutHistoryAction.mockResolvedValue({ kind: "ok", entries: [abandonedEntry] });

    const page = await HistoryPage({ searchParams: Promise.resolve({}) });
    const text = textOf(page);

    expect(text).toContain("Discarded — not completed");
    // sessionDurationMinutes already returns undefined with no completedAt
    // (a pre-existing safeguard, not a new branch) — confirm it stays a
    // no-op rather than rendering a bogus duration for an abandoned session.
    expect(text).not.toContain("min");
    // The abandoned session's own volume is still shown truthfully.
    expect(text).toContain("50");
  });

  it("introduces no navigable element for an abandoned session in history", async () => {
    getWorkoutHistoryAction.mockResolvedValue({ kind: "ok", entries: [abandonedEntry] });

    const page = await HistoryPage({ searchParams: Promise.resolve({}) });

    expect(hasAnchor(page)).toBe(false);
  });
});

// --- React tree inspection helpers ---

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isReactElement(node)) return textOf(node.props.children);
  return "";
}

function isReactElement(node: ReactNode): node is AnyElement {
  return typeof node === "object" && node !== null && "props" in node;
}

function hasAnchor(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasAnchor);
  if (!isReactElement(node)) return false;
  if (node.type === "a") return true;
  return hasAnchor(node.props.children);
}
