import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";
import { resolveMessages } from "../../../i18n/locale.js";
import type { FetchPlanStatusResult } from "../../../api/plan-status-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `react-native`'s entry point uses Flow's `import typeof` syntax Vite/Rollup
// cannot parse (no Metro/Babel transform in this Vitest env) — same constraint
// `PlanStatusScreen.test.tsx` documents. Stub the handful of primitives the
// screen uses with passthrough host elements so the REAL component tree still
// renders and asserts.
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
}));

const TrainerPlanScreen = (await import("../TrainerPlanScreen.js")).default;

const program = (sessionCount: number): WorkoutProgram => ({
  weeklySessions: Array.from({ length: sessionCount }, (_, i) => ({
    day: i + 1,
    title: `Day ${i + 1}`,
    exercises: [],
  })),
  limitationWarnings: [],
});

const ok = (
  status: string,
  extra: Record<string, unknown> = {},
): FetchPlanStatusResult => ({
  kind: "ok",
  plan: { id: "plan_9", status, ...extra },
});

const denied = (): FetchPlanStatusResult => ({
  kind: "error",
  message: "forbidden",
  status: 403,
});

function makeClient(
  overrides: {
    fetchTrainerPlan?: (...a: any[]) => Promise<FetchPlanStatusResult>;
  } = {},
) {
  return {
    fetchTrainerPlan:
      overrides.fetchTrainerPlan ??
      vi.fn(async () => ok("ready", { program: program(3) })),
  };
}

function renderScreen(props: Record<string, unknown> = {}) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" defaultLocale="en" messages={resolveMessages("en")}>
        <TrainerPlanScreen {...props} />
      </IntlProvider>,
    );
  });
  return { renderer };
}

const has = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id).length > 0;
const all = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id);

async function settle() {
  await act(async () => {});
}

describe("TrainerPlanScreen (15b-v2 Phase S5 — client-facing branded-plan view)", () => {
  it("renders a loading state before the fetch resolves", async () => {
    let resolveFetch!: (value: FetchPlanStatusResult) => void;
    const client = makeClient({
      fetchTrainerPlan: vi.fn(
        () => new Promise<FetchPlanStatusResult>((resolve) => { resolveFetch = resolve; }),
      ),
    });
    const { renderer } = renderScreen({ client });

    expect(has(renderer, "trainer-plan-loading")).toBe(true);

    await act(async () => {
      resolveFetch(ok("ready", { program: program(1) }));
    });
  });

  it("renders a denied state when the caller has no active trainer assignment", async () => {
    const client = makeClient({ fetchTrainerPlan: vi.fn(async () => denied()) });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "trainer-plan-denied")).toBe(true);
  });

  it("renders a pending state when the assignment exists but the plan is still generating", async () => {
    const client = makeClient({
      fetchTrainerPlan: vi.fn(async () => ok("generating")),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "trainer-plan-pending")).toBe(true);
  });

  it("renders a pending state when the plan failed to generate", async () => {
    const client = makeClient({
      fetchTrainerPlan: vi.fn(async () => ok("failed")),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "trainer-plan-pending")).toBe(true);
  });

  it("renders the ready program summary (weeklySessions) after loading", async () => {
    const client = makeClient({
      fetchTrainerPlan: vi.fn(async () => ok("ready", { program: program(3) })),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "trainer-plan-ready")).toBe(true);
    expect(all(renderer, "session-row")).toHaveLength(3);
  });
});

describe("TrainerPlanScreen — trainer branding accent seam (15b-v2 S5, reusing the S4 seam)", () => {
  function flattenColor(style: unknown): string | undefined {
    if (Array.isArray(style)) {
      for (let i = style.length - 1; i >= 0; i -= 1) {
        const color = flattenColor(style[i]);
        if (color) return color;
      }
      return undefined;
    }
    if (style && typeof style === "object" && "color" in (style as Record<string, unknown>)) {
      return (style as Record<string, unknown>).color as string;
    }
    return undefined;
  }

  function flattenText(node: unknown): string {
    if (node == null) return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(flattenText).join("");
    if (typeof node === "object" && "children" in (node as Record<string, unknown>)) {
      return flattenText((node as { children: unknown }).children);
    }
    return "";
  }

  it("renders the branded title, trainer byline, and accent-themed session count when branding is present", async () => {
    const client = makeClient({
      fetchTrainerPlan: vi.fn(async () =>
        ok("ready", {
          program: program(2),
          branding: { trainerName: "Coach Ana", title: "Ana's Summer Cut", accentColor: "#1E90FF" },
        }),
      ),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    const text = flattenText(renderer.toJSON());
    expect(text).toContain("Ana's Summer Cut");
    expect(text).toContain("Coach Ana");

    const sessionCount = renderer.root.find((n) => n.props.testID === "ready-sessions");
    expect(flattenColor(sessionCount.props.style)).toBe("#1E90FF");
  });

  it("renders the base (unbranded) plan unchanged when branding is absent", async () => {
    const client = makeClient({
      fetchTrainerPlan: vi.fn(async () => ok("ready", { program: program(2) })),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "branding-byline")).toBe(false);

    const sessionCount = renderer.root.find((n) => n.props.testID === "ready-sessions");
    expect(flattenColor(sessionCount.props.style)).toBe("#A8F060");
  });
});
