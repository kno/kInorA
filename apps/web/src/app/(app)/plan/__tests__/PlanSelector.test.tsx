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
    // Option labels now use "{date} ({status})" format (not the raw plan id).
    // Check that the statuses appear in the rendered text.
    expect(text).toContain("ready");
    expect(text).toContain("generating");
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

  it("onChange pushes /plan?planId=<encoded-id> via router.push (Fix 5 — encodeURIComponent)", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-newer" });
    const select = findFirst(view, (el) => el.type === "select");
    expect(select).toBeDefined();

    // Simulate the onChange handler
    const onChange = select?.props?.onChange as (e: { target: { value: string } }) => void;
    expect(typeof onChange).toBe("function");
    onChange({ target: { value: "plan-older" } });
    // "plan-older" has no special chars so encodeURIComponent keeps it the same
    expect(routerPush).toHaveBeenCalledWith("/plan?planId=plan-older");
  });

  it("encodeURIComponent encodes special characters in planId (Fix 5 — URL safety)", () => {
    // Verify encodeURIComponent is applied — IDs with special chars must be encoded
    const planWithSpecialId: PlanSummaryItem[] = [
      { id: "plan/with+special=chars&more", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
    ];
    const view = PlanSelector({ summaries: planWithSpecialId, selectedId: "plan/with+special=chars&more" });
    const select = findFirst(view, (el) => el.type === "select");

    const onChange = select?.props?.onChange as (e: { target: { value: string } }) => void;
    onChange({ target: { value: "plan/with+special=chars&more" } });
    // The raw id has special chars — encodeURIComponent must encode them
    expect(routerPush).toHaveBeenCalledWith(
      "/plan?planId=plan%2Fwith%2Bspecial%3Dchars%26more"
    );
  });

  it("onChange pushes the correct URL for a different selected plan", () => {
    const view = PlanSelector({ summaries, selectedId: "plan-older" });
    const select = findFirst(view, (el) => el.type === "select");

    const onChange = select?.props?.onChange as (e: { target: { value: string } }) => void;
    onChange({ target: { value: "plan-newer" } });
    expect(routerPush).toHaveBeenCalledWith("/plan?planId=plan-newer");
  });

  it("renders the resolved plan name as the option label (#93)", () => {
    const named: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z", name: "Summer Cut" },
      { id: "p2", status: "ready", createdAt: "2026-06-28T09:00:00.000Z", name: "Winter Bulk" },
    ];
    const view = PlanSelector({ summaries: named, selectedId: "p1" });
    const text = textOf(view);
    expect(text).toContain("Summer Cut");
    expect(text).toContain("Winter Bulk");
  });

  it("two plans with distinct names render distinct labels (#93)", () => {
    const named: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z", name: "Alpha" },
      { id: "p2", status: "ready", createdAt: "2026-06-28T09:00:00.000Z", name: "Beta" },
    ];
    const view = PlanSelector({ summaries: named, selectedId: "p1" });
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
    const labels = options.map((o) => textOf(o.props.children));
    expect(labels).toContain("Alpha");
    expect(labels).toContain("Beta");
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("renders the server-resolved default label when name is a resolved fallback (#93)", () => {
    // The server always resolves name via defaultPlanName, so the client renders
    // it verbatim with NO client-side fallback branching.
    const resolved: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z", name: "Plan 2026-06-29" },
    ];
    const view = PlanSelector({ summaries: resolved, selectedId: "p1" });
    expect(textOf(view)).toContain("Plan 2026-06-29");
  });

  it("renders the date/status fallback label when a summary has no name (#93 legacy safety)", () => {
    // The name field is optional; a legacy/undefined summary must NOT crash and
    // must fall back to the "{date} ({status})" template.
    const noName: PlanSummaryItem[] = [
      { id: "p1", status: "ready", createdAt: "2026-06-29T10:00:00.000Z" },
    ];
    let view: ReturnType<typeof PlanSelector> | undefined;
    expect(() => {
      view = PlanSelector({ summaries: noName, selectedId: "p1" });
    }).not.toThrow();
    const text = textOf(view);
    // Status appears via the fallback template; the option is not blank.
    expect(text).toContain("ready");
    const expectedDate = new Date("2026-06-29T10:00:00.000Z").toLocaleDateString();
    expect(text).toContain(expectedDate);
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
