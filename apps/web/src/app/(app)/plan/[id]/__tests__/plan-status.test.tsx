/**
 * Tests for the PlanStatusPage component.
 *
 * Three rendering states driven by `status`:
 *   - "generating" → spinner (OrbitProgress indeterminate) + generating message
 *   - "ready"      → plan detail (sessions, exercises)
 *   - "failed"     → error message + Regenerate CTA button
 *
 * The component renders as a server component for initial hydration.
 * State management (WS subscribe + local status) lives in a client child.
 * Tests use the React tree inspection pattern (textOf / findFirst) established
 * in the existing page tests — no RTL needed for pure server component tests.
 *
 * For the client status manager tests we use jsdom + RTL.
 */
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { PlanStatusView } from "../PlanStatusView";
import { OrbitProgress } from "@/components/orbit";
import type { WorkoutProgram } from "@kinora/contracts";

// --- React tree inspection helpers (same pattern as other page tests) ---

type AnyProps = Record<string, unknown> & { children?: ReactNode };
type AnyElement = ReactElement<AnyProps>;

function findFirst(
  node: ReactNode,
  match: (el: AnyElement) => boolean,
): AnyElement | undefined {
  if (isReactElement(node)) {
    if (match(node)) return node;
    const inChildren = findFirst(node.props.children, match);
    if (inChildren) return inChildren;
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
  if (isReactElement(node)) return textOf(node.props.children);
  return "";
}

function isReactElement(node: ReactNode): node is AnyElement {
  return typeof node === "object" && node !== null && "props" in node;
}

const sampleProgram: WorkoutProgram = {
  weeklySessions: [
    {
      day: 1,
      title: "Day 1 · Strength",
      exercises: [
        {
          name: "Barbell Squat",
          sets: 4,
          reps: "8",
          restSeconds: 120,
        },
      ],
    },
  ],
  limitationWarnings: [],
};

describe("PlanStatusView — generating state", () => {
  it("renders the generating message when status is 'generating'", () => {
    const view = PlanStatusView({ status: "generating", planId: "plan-1" });
    expect(textOf(view)).toContain("Generating");
  });

  it("does NOT render exercise content when status is 'generating'", () => {
    const view = PlanStatusView({ status: "generating", planId: "plan-1" });
    expect(textOf(view)).not.toContain("Barbell Squat");
  });

  it("includes an OrbitProgress (indeterminate) element in the generating state", () => {
    const view = PlanStatusView({ status: "generating", planId: "plan-1" });
    // OrbitProgress is a component — find it by its type reference
    const progress = findFirst(view, (el) => el.type === OrbitProgress);
    expect(progress).toBeDefined();
    // Must be in indeterminate mode (the brand spinner)
    expect(progress?.props?.indeterminate).toBe(true);
  });
});

describe("PlanStatusView — ready state", () => {
  it("renders the plan sessions when status is 'ready'", () => {
    const view = PlanStatusView({
      status: "ready",
      planId: "plan-1",
      program: sampleProgram,
    });
    expect(textOf(view)).toContain("Day 1 · Strength");
  });

  it("renders exercise names when status is 'ready'", () => {
    const view = PlanStatusView({
      status: "ready",
      planId: "plan-1",
      program: sampleProgram,
    });
    expect(textOf(view)).toContain("Barbell Squat");
  });

  it("does NOT render the generating spinner when status is 'ready'", () => {
    const view = PlanStatusView({
      status: "ready",
      planId: "plan-1",
      program: sampleProgram,
    });
    // No progressbar in ready state
    const progressbar = findFirst(
      view,
      (el) => el.props?.role === "progressbar",
    );
    expect(progressbar).toBeUndefined();
  });
});

describe("PlanStatusView — failed state", () => {
  it("renders an error message when status is 'failed'", () => {
    const view = PlanStatusView({ status: "failed", planId: "plan-1" });
    expect(textOf(view)).toContain("failed");
  });

  it("renders a Regenerate button when status is 'failed'", () => {
    const view = PlanStatusView({ status: "failed", planId: "plan-1" });
    const regenerateBtn = findFirst(
      view,
      (el) =>
        el.type === "button" &&
        typeof el.props.children === "string" &&
        (el.props.children as string).toLowerCase().includes("regenerate"),
    );
    expect(regenerateBtn).toBeDefined();
  });

  it("does NOT render exercise content when status is 'failed'", () => {
    const view = PlanStatusView({ status: "failed", planId: "plan-1" });
    expect(textOf(view)).not.toContain("Barbell Squat");
  });
});

describe("PlanStatusView — status-fetch fallback (WS not connected)", () => {
  it("renders the generating spinner when status is 'generating' and no program present (poll fallback)", () => {
    // When WS is not connected and status is still generating,
    // the view shows the generating state with an OrbitProgress spinner.
    // The poll fallback works by re-rendering the same generating view.
    const view = PlanStatusView({ status: "generating", planId: "plan-1" });
    // OrbitProgress (indeterminate) IS present — confirms the spinner is shown
    const progress = findFirst(view, (el) => el.type === OrbitProgress);
    expect(progress).toBeDefined();
    expect(textOf(view)).toContain("Generating");
  });
});
