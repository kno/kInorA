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

const listPlansWithProgressAction = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: async () => createServerTranslator(),
}));

vi.mock("../actions.js", () => ({
  listPlansWithProgressAction: (...args: unknown[]) => listPlansWithProgressAction(...args),
}));

vi.mock("../PlanList.js", () => ({
  PlanList: (props: AnyProps) => null,
}));

import PlansPage from "../page";
import { PlanList } from "../PlanList";
import { createServerTranslator } from "@/test-utils/server-translator";

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlansPage — load failure vs empty (17d PR A)", () => {
  it("renders a distinguishable role=alert error state when the fetch fails, never the empty-account state", async () => {
    listPlansWithProgressAction.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await PlansPage();

    const alert = findFirst(page, (el) => el.props?.role === "alert");
    expect(alert).toBeDefined();
    const emptyCta = findFirst(page, (el) => el.type === "a" && el.props?.href === "/create-plan");
    expect(emptyCta).toBeUndefined();
    const list = findFirst(page, (el) => el.type === PlanList);
    expect(list).toBeUndefined();
  });

  it("renders the empty state with a create-plan CTA when the user genuinely owns zero plans", async () => {
    listPlansWithProgressAction.mockResolvedValue({ kind: "ok", plans: [] });

    const page = await PlansPage();

    const alert = findFirst(page, (el) => el.props?.role === "alert");
    expect(alert).toBeUndefined();
    const emptyCta = findFirst(page, (el) => el.type === "a" && el.props?.href === "/create-plan");
    expect(emptyCta).toBeDefined();
  });

  it("renders PlanList when the user has plans", async () => {
    const plans = [{ id: "plan-1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" }];
    listPlansWithProgressAction.mockResolvedValue({ kind: "ok", plans });

    const page = await PlansPage();

    const list = findFirst(page, (el) => el.type === PlanList);
    expect(list).toBeDefined();
    expect(list?.props?.plans).toEqual(plans);
  });
});
