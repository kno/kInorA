// @vitest-environment jsdom
/**
 * Tests for PlanStatusView — verifies the four rendering states driven by the
 * `status` prop:
 *   - "generating" → spinner (OrbitProgress indeterminate) + generating message
 *   - "ready"      → plan detail (sessions, exercises)
 *   - "failed"     → error message + Regenerate CTA button
 *   - "error"      → connection-error message + Retry CTA (issue #42)
 *
 * PlanStatusView is a client component (`useTranslations`), so it is rendered
 * via RTL + `renderWithIntl` rather than called directly as a plain function
 * (calling a component with hooks outside of React's render cycle throws
 * "Invalid hook call").
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { PlanStatusView } from "../PlanStatusView";
import type { WorkoutProgram } from "@kinora/contracts";

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
    renderWithIntl(<PlanStatusView status="generating" planId="plan-1" />);
    expect(screen.getByText("Generating your plan…")).toBeDefined();
  });

  it("does NOT render exercise content when status is 'generating'", () => {
    renderWithIntl(<PlanStatusView status="generating" planId="plan-1" />);
    expect(screen.queryByText("Barbell Squat")).toBeNull();
  });

  it("includes an OrbitProgress (indeterminate) element in the generating state", () => {
    renderWithIntl(<PlanStatusView status="generating" planId="plan-1" />);
    const progress = screen.getByRole("progressbar", { name: "Generating plan" });
    expect(progress).toBeDefined();
  });
});

describe("PlanStatusView — ready state", () => {
  it("renders the plan sessions when status is 'ready'", () => {
    renderWithIntl(
      <PlanStatusView status="ready" planId="plan-1" program={sampleProgram} />,
    );
    expect(screen.getByText(/Day 1 · Strength/)).toBeDefined();
  });

  it("renders exercise names when status is 'ready'", () => {
    renderWithIntl(
      <PlanStatusView status="ready" planId="plan-1" program={sampleProgram} />,
    );
    expect(screen.getByText("Barbell Squat")).toBeDefined();
  });

  it("does NOT render the generating spinner when status is 'ready'", () => {
    renderWithIntl(
      <PlanStatusView status="ready" planId="plan-1" program={sampleProgram} />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("PlanStatusView — failed state", () => {
  it("renders an error message when status is 'failed'", () => {
    renderWithIntl(<PlanStatusView status="failed" planId="plan-1" />);
    expect(screen.getByText("Plan generation failed")).toBeDefined();
  });

  it("renders a Regenerate button when status is 'failed'", () => {
    renderWithIntl(<PlanStatusView status="failed" planId="plan-1" />);
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeDefined();
  });

  it("does NOT render exercise content when status is 'failed'", () => {
    renderWithIntl(<PlanStatusView status="failed" planId="plan-1" />);
    expect(screen.queryByText("Barbell Squat")).toBeNull();
  });
});

describe("PlanStatusView — error state (issue #42 reliability: fail loud)", () => {
  it("renders a connection-error message when status is 'error' (not a stale spinner)", () => {
    renderWithIntl(<PlanStatusView status="error" planId="plan-1" />);
    // Must NOT keep showing the generating spinner (that was the silent-stuck bug).
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("Connection problem")).toBeDefined();
  });

  it("does NOT render exercise content when status is 'error'", () => {
    renderWithIntl(
      <PlanStatusView status="error" planId="plan-1" program={sampleProgram} />,
    );
    expect(screen.queryByText("Barbell Squat")).toBeNull();
  });

  it("offers a way to retry (Regenerate) when status is 'error' and a handler is provided", () => {
    renderWithIntl(
      <PlanStatusView status="error" planId="plan-1" onRegenerate={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });
});

describe("PlanStatusView — status-fetch fallback (WS not connected)", () => {
  it("renders the generating spinner when status is 'generating' and no program present (poll fallback)", () => {
    // When WS is not connected and status is still generating,
    // the view shows the generating state with an OrbitProgress spinner.
    // The poll fallback works by re-rendering the same generating view.
    renderWithIntl(<PlanStatusView status="generating" planId="plan-1" />);
    // OrbitProgress (indeterminate) IS present — confirms the spinner is shown
    expect(screen.getByRole("progressbar")).toBeDefined();
    expect(screen.getByText("Generating your plan…")).toBeDefined();
  });
});
