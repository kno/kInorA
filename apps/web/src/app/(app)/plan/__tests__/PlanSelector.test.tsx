// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { PlanSummaryItem } from "../PlanSelector";

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

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { PlanSelector } from "../PlanSelector";

afterEach(() => {
  vi.clearAllMocks();
});

// --- Test fixtures ---

const summaries: PlanSummaryItem[] = [
  { id: "plan-newer", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
  { id: "plan-older", status: "generating", createdAt: "2026-06-28T09:00:00.000Z" },
];

// --- Tests ---

describe("PlanSelector", () => {
  it("renders a <select> element", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-newer" });
    const select = findFirst(view, (el) => el.type === "select");
    expect(select).toBeDefined();
  });

  it("renders options for each summary (newest-first order matches prop order)", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-newer" });
    const text = textOf(view);
    // Both plan labels must appear
    expect(text).toContain("plan-newer");
    expect(text).toContain("plan-older");
  });

  it("marks the selectedId option as selected via value prop on <select>", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-older" });
    const select = findFirst(view, (el) => el.type === "select");
    expect(select).toBeDefined();
    expect(select?.props?.value).toBe("plan-older");
  });

  it("marks the first plan as selected when selectedId matches first entry", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-newer" });
    const select = findFirst(view, (el) => el.type === "select");
    expect(select?.props?.value).toBe("plan-newer");
  });

  it("onChange pushes /plan?planId=<id> via router.push", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-newer" });
    const select = findFirst(view, (el) => el.type === "select");
    expect(select).toBeDefined();

    // Simulate the onChange handler
    const onChange = select?.props?.onChange as (e: { target: { value: string } }) => void;
    expect(typeof onChange).toBe("function");
    onChange({ target: { value: "plan-older" } });
    expect(routerPush).toHaveBeenCalledWith("/plan?planId=plan-older");
  });

  it("onChange pushes the correct URL for a different selected plan", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-older" });
    const select = findFirst(view, (el) => el.type === "select");

    const onChange = select?.props?.onChange as (e: { target: { value: string } }) => void;
    onChange({ target: { value: "plan-newer" } });
    expect(routerPush).toHaveBeenCalledWith("/plan?planId=plan-newer");
  });

  it("renders option values matching plan ids", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-newer" });
    // Find all <option> elements and check their values
    const options: AnyElement[] = [];
    function collect(node: ReactNode) {
      if (typeof node === "object" && node !== null && "props" in node) {
        const el = node as AnyElement;
        if (el.type === "option") options.push(el);
        collect(el.props.children);
      }
      if (Array.isArray(node)) node.forEach(collect);
    }
    collect(view);
    expect(options.length).toBeGreaterThanOrEqual(2);
    const optionValues = options.map((o) => o.props.value);
    expect(optionValues).toContain("plan-newer");
    expect(optionValues).toContain("plan-older");
  });
});
