// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

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

const redirect = vi.fn();
const listPlansAction = vi.fn();
const getPlanStatusAction = vi.fn();

// PlanPage is a server component (`getTranslations`) — see
// `server-translator.ts` for why this is mocked rather than run for real
// (the real next-intl/server RSC build isn't available under Vitest).
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

vi.mock("../actions.js", () => ({
  listPlansAction: (...args: unknown[]) => listPlansAction(...args),
}));

vi.mock("../../plan/[id]/actions.js", () => ({
  getPlanStatusAction: (...args: unknown[]) => getPlanStatusAction(...args),
}));

// Stub PlanStatusView and PlanSelector — function components so we can find
// them by component reference in the tree (same pattern as ai-config page tests).
vi.mock("../../plan/[id]/PlanStatusView.js", () => ({
  PlanStatusView: (props: AnyProps) => null,
}));

vi.mock("../PlanSelector.js", () => ({
  PlanSelector: (props: AnyProps) => null,
}));

// Stub PlanWeekView — the new ready-state component wired in T4.
vi.mock("../PlanWeekView.js", () => ({
  PlanWeekView: (props: AnyProps) => null,
}));

import PlanPage from "../page";
import { PlanStatusView } from "../../plan/[id]/PlanStatusView";
import { PlanSelector } from "../PlanSelector";
import { PlanWeekView } from "../PlanWeekView";
import { createServerTranslator } from "@/test-utils/server-translator";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Test fixtures ---

const readyPlan = {
  id: "plan-newer",
  status: "ready",
  program: {
    weeklySessions: [{ day: 1, title: "Push Day", exercises: [] }],
    limitationWarnings: [],
  },
  specId: "spec-1",
};

const generatingPlan = {
  id: "plan-gen",
  status: "generating",
  program: undefined,
  specId: "spec-2",
};

const failedPlan = {
  id: "plan-fail",
  status: "failed",
  program: undefined,
  specId: "spec-3",
};

const summaries = [
  { id: "plan-newer", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
  { id: "plan-older", status: "failed", createdAt: "2026-06-28T09:00:00.000Z" },
];

// --- Tests ---

describe("PlanPage — empty state (SC-12, SC-21)", () => {
  it("renders an anchor linking to /create-plan when user has no plans (SC-12)", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: [] });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const link = findFirst(
      page,
      (el) => el.type === "a" && el.props?.href === "/create-plan"
    );
    expect(link).toBeDefined();
  });

  it("does NOT render PlanSelector when user has no plans", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: [] });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const selector = findFirst(page, (el) => el.type === PlanSelector);
    expect(selector).toBeUndefined();
  });

  it("renders anchor to /create-plan when listPlansAction returns an error (SC-21, fail-open)", async () => {
    listPlansAction.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const link = findFirst(
      page,
      (el) => el.type === "a" && el.props?.href === "/create-plan"
    );
    expect(link).toBeDefined();
  });

  it("does not call getPlanStatusAction when list is empty", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: [] });

    await PlanPage({ searchParams: Promise.resolve({}) });

    expect(getPlanStatusAction).not.toHaveBeenCalled();
  });
});

describe("PlanPage — default-latest selection (SC-13)", () => {
  it("defaults to the first (newest) plan when no ?planId param is present", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    await PlanPage({ searchParams: Promise.resolve({}) });

    expect(getPlanStatusAction).toHaveBeenCalledWith("plan-newer");
  });
});

describe("PlanPage — ?planId selection (SC-14)", () => {
  it("uses searchParams.planId to select the plan when present", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: { ...failedPlan, id: "plan-older" } });

    await PlanPage({ searchParams: Promise.resolve({ planId: "plan-older" }) });

    expect(getPlanStatusAction).toHaveBeenCalledWith("plan-older");
  });
});

describe("PlanPage — unowned planId fallback (SC-15)", () => {
  it("falls back to the latest plan when ?planId detail returns an error", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    // First call for the unowned planId returns error (not found)
    getPlanStatusAction
      .mockResolvedValueOnce({ kind: "error", message: "not_found" })
      // Fallback call for the default (latest) plan
      .mockResolvedValueOnce({ kind: "ok", plan: readyPlan });

    await PlanPage({ searchParams: Promise.resolve({ planId: "plan-stale-unowned" }) });

    // Should have retried with the fallback (summaries[0].id = "plan-newer")
    expect(getPlanStatusAction).toHaveBeenCalledWith("plan-newer");
  });
});

describe("PlanPage — ready state (SC-18 / T4 wiring)", () => {
  it("renders PlanWeekView when selected plan is ready", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView).toBeDefined();
  });

  it("passes the plan program to PlanWeekView when ready", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView?.props?.program).toBeDefined();
    // Verify program has the expected weeklySessions from readyPlan
    expect((weekView?.props?.program as { weeklySessions: unknown[] })?.weeklySessions).toHaveLength(1);
  });

  it("does NOT render PlanStatusView for the ready state (old layout removed)", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    // PlanStatusView must not appear at all in the ready branch
    // (it is still used for failed branch — verified separately)
    const statusView = findFirst(
      page,
      (el) => el.type === PlanStatusView && el.props?.status === "ready",
    );
    expect(statusView).toBeUndefined();
  });

  it("does NOT pass a messages prop to PlanWeekView (getTranslations, not loadMessages)", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView?.props?.messages).toBeUndefined();
  });
});

describe("PlanPage — generating state (SC-19)", () => {
  it("calls redirect to /plan/[id] when selected plan is generating", async () => {
    listPlansAction.mockResolvedValue({
      kind: "ok",
      plans: [{ id: "plan-gen", status: "generating", createdAt: "2026-06-29T10:00:00.000Z" }],
    });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: generatingPlan });

    await PlanPage({ searchParams: Promise.resolve({}) });

    expect(redirect).toHaveBeenCalledWith("/plan/plan-gen");
  });
});

describe("PlanPage — failed state (SC-20)", () => {
  it("renders PlanStatusView with status='failed' for a failed plan", async () => {
    listPlansAction.mockResolvedValue({
      kind: "ok",
      plans: [{ id: "plan-fail", status: "failed", createdAt: "2026-06-29T10:00:00.000Z" }],
    });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: failedPlan });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const statusView = findFirst(page, (el) => el.type === PlanStatusView);
    expect(statusView).toBeDefined();
    expect(statusView?.props?.status).toBe("failed");
  });

  it("renders a link to /plan/[id] when selected plan is failed (SC-20)", async () => {
    listPlansAction.mockResolvedValue({
      kind: "ok",
      plans: [{ id: "plan-fail", status: "failed", createdAt: "2026-06-29T10:00:00.000Z" }],
    });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: failedPlan });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const link = findFirst(
      page,
      (el) => el.type === "a" && typeof el.props?.href === "string" && (el.props.href as string).includes("plan-fail")
    );
    expect(link).toBeDefined();
  });
});

describe("PlanPage — selector presence (SC-16, SC-17)", () => {
  it("renders PlanSelector when multiple plans exist (SC-16)", async () => {
    listPlansAction.mockResolvedValue({ kind: "ok", plans: summaries });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: readyPlan });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const selector = findFirst(page, (el) => el.type === PlanSelector);
    expect(selector).toBeDefined();
  });

  it("renders PlanWeekView for the selected plan even when only one plan exists (SC-17)", async () => {
    const singleSummary = [{ id: "plan-only", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" }];
    listPlansAction.mockResolvedValue({ kind: "ok", plans: singleSummary });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: { ...readyPlan, id: "plan-only" } });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const weekView = findFirst(page, (el) => el.type === PlanWeekView);
    expect(weekView).toBeDefined();
  });

  it("does NOT render PlanSelector when only one plan exists (SC-17)", async () => {
    const singleSummary = [{ id: "plan-only", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" }];
    listPlansAction.mockResolvedValue({ kind: "ok", plans: singleSummary });
    getPlanStatusAction.mockResolvedValue({ kind: "ok", plan: { ...readyPlan, id: "plan-only" } });

    const page = await PlanPage({ searchParams: Promise.resolve({}) });
    const selector = findFirst(page, (el) => el.type === PlanSelector);
    expect(selector).toBeUndefined();
  });
});
