// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

// --- React tree inspection helpers (mirrors ../../plan/__tests__/page.test.tsx) ---

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

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    return textOf((node as AnyElement).props.children);
  }
  return "";
}

// --- Module mocks ---

const getTrainerPlanAction = vi.fn();

// TrainerPlanPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

vi.mock("../actions.js", () => ({
  getTrainerPlanAction: (...args: unknown[]) => getTrainerPlanAction(...args),
}));

// Stub PlanWeekView — a function component so we can find it by component
// reference in the tree (same pattern as plan/__tests__/page.test.tsx).
vi.mock("../../plan/PlanWeekView.js", () => ({
  PlanWeekView: (props: AnyProps) => null,
}));

import TrainerPlanPage from "../page";
import { PlanWeekView } from "../../plan/PlanWeekView";
import { createServerTranslator } from "@/test-utils/server-translator";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Test fixtures ---

const readyPlan = {
  id: "plan-1",
  status: "ready",
  program: {
    weeklySessions: [{ day: 1, title: "Push Day", exercises: [] }],
    limitationWarnings: [],
  },
  name: "Summer Cut",
};

const branding = { trainerName: "Coach Ana", title: "Ana's Cut", accentColor: "#1E90FF" };

describe("TrainerPlanPage — denied state (S2 authorization preserved)", () => {
  it("renders a denied notice when getTrainerPlanAction returns an error (e.g. 403 no active assignment)", async () => {
    getTrainerPlanAction.mockResolvedValue({ kind: "error", message: "forbidden" });

    const page = await TrainerPlanPage();

    expect(textOf(page)).toContain("No trainer plan yet");
    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView).toBeUndefined();
  });
});

describe("TrainerPlanPage — pending state (plan not ready yet)", () => {
  it("renders a pending notice when the plan is still generating", async () => {
    getTrainerPlanAction.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "generating" },
    });

    const page = await TrainerPlanPage();

    expect(textOf(page)).toContain("Your trainer is preparing your plan");
  });

  it("renders a pending notice when the plan failed to generate", async () => {
    getTrainerPlanAction.mockResolvedValue({
      kind: "ok",
      plan: { id: "plan-1", status: "failed" },
    });

    const page = await TrainerPlanPage();

    expect(textOf(page)).toContain("Your trainer is preparing your plan");
  });
});

describe("TrainerPlanPage — ready state (client opens the branded plan)", () => {
  it("renders PlanWeekView with the resolved program/planName/planId when ready", async () => {
    getTrainerPlanAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await TrainerPlanPage();

    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView).toBeDefined();
    expect(weekView?.props?.planId).toBe("plan-1");
    expect(weekView?.props?.planName).toBe("Summer Cut");
    expect((weekView?.props?.program as { weeklySessions: unknown[] })?.weeklySessions).toHaveLength(1);
  });

  it("threads branding onto PlanWeekView when the trainer set it", async () => {
    getTrainerPlanAction.mockResolvedValue({ kind: "ok", plan: { ...readyPlan, branding } });

    const page = await TrainerPlanPage();

    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView?.props?.branding).toEqual(branding);
  });

  it("passes undefined branding when the plan has none (absent branding renders base plan)", async () => {
    getTrainerPlanAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await TrainerPlanPage();

    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView?.props?.branding).toBeUndefined();
  });
});
