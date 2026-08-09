import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../../i18n/locale.js";
import type {
  FetchPlanListResult,
  PlanArchiveResult,
  PlanListItem,
} from "../../../api/plan-status-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `react-native`'s entry point uses Flow's `import typeof` syntax Vite/Rollup
// cannot parse (no Metro/Babel transform in this Vitest env) — the same
// constraint `HomeScreen.test.tsx` / `PlanStatusScreen.test.tsx` document.
// Stub the primitives this screen uses with passthrough host elements so the
// REAL component tree (its `useIntl()` calls, state, list fetch) renders.
vi.mock("react-native", () => ({
  View: "View",
  ScrollView: "ScrollView",
  Text: "Text",
  Pressable: ({ children, style, onPress, ...rest }: any) => (
    <button type="button" onClick={onPress} {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
}));

// `../../auth/session-storage` transitively imports `expo-secure-store` →
// `expo-modules-core`, which reads the RN global `__DEV__` at module scope.
vi.mock("../../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(async () => {}),
}));

const PlansScreen = (await import("../PlansScreen.js")).default;

const NOW = new Date("2026-08-09T12:00:00.000Z");

const activePlan: PlanListItem = {
  id: "plan_9",
  status: "ready",
  createdAt: "2026-07-01T09:00:00.000Z",
  name: "Hypertrophy Block",
  daysPerWeek: 4,
  completedSessions: 7,
  lastTrainedAt: "2026-08-06T18:30:00.000Z",
};

const secondPlan: PlanListItem = {
  id: "plan_8",
  status: "ready",
  createdAt: "2026-06-01T09:00:00.000Z",
  name: "Strength Base",
  daysPerWeek: 3,
  completedSessions: 12,
  lastTrainedAt: "2026-03-01T18:30:00.000Z",
};

const archivedPlan: PlanListItem = {
  id: "plan_7",
  status: "ready",
  createdAt: "2026-01-01T09:00:00.000Z",
  name: "Winter Cut",
  daysPerWeek: 5,
  completedSessions: 30,
  archivedAt: "2026-04-01T09:00:00.000Z",
};

const ok = (plans: PlanListItem[]): FetchPlanListResult => ({ kind: "ok", plans });

function makeClient(
  overrides: {
    fetchPlanList?: (...a: any[]) => Promise<FetchPlanListResult>;
    archivePlan?: (...a: any[]) => Promise<PlanArchiveResult>;
    unarchivePlan?: (...a: any[]) => Promise<PlanArchiveResult>;
  } = {},
) {
  return {
    fetchPlanList: overrides.fetchPlanList ?? vi.fn(async () => ok([activePlan, secondPlan])),
    archivePlan:
      overrides.archivePlan ??
      vi.fn(async (id: string) => ({
        kind: "ok" as const,
        id,
        archivedAt: "2026-08-09T12:00:00.000Z",
      })),
    unarchivePlan:
      overrides.unarchivePlan ??
      vi.fn(async (id: string) => ({ kind: "ok" as const, id, archivedAt: null })),
  };
}

function renderScreen(
  props: { client?: ReturnType<typeof makeClient> } & Record<string, unknown> = {},
) {
  const navigation = { navigate: vi.fn(), reset: vi.fn(), replace: vi.fn() } as any;
  const clearSession = vi.fn(async () => {});
  const client = props.client ?? makeClient();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" defaultLocale="en" messages={resolveMessages("en")}>
        <PlansScreen
          navigation={navigation}
          clearSession={clearSession}
          now={NOW}
          {...props}
          client={client as any}
        />
      </IntlProvider>,
    );
  });
  return { renderer, navigation, clearSession, client };
}

const has = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id).length > 0;

const byId = (r: ReactTestRenderer, id: string) => r.root.find((n) => n.props.testID === id);

/** Flatten the rendered tree to plain text, for copy assertions. */
function text(r: ReactTestRenderer): string {
  return JSON.stringify(r.toJSON());
}

async function settle() {
  await act(async () => {});
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PlansScreen (17d PR C — mobile plans list + archive)", () => {
  it("renders every plan with its days-per-week, completed sessions and last-trained line", async () => {
    const { renderer, client } = renderScreen();
    await settle();

    expect(client.fetchPlanList).toHaveBeenCalledTimes(1);
    expect(has(renderer, "plan-card-plan_9")).toBe(true);
    expect(has(renderer, "plan-card-plan_8")).toBe(true);

    const rendered = text(renderer);
    expect(rendered).toContain("Hypertrophy Block");
    expect(rendered).toContain("4 days/week");
    expect(rendered).toContain("7 completed");
    expect(rendered).toContain("Last trained");
    // The first ready plan is the one being followed — not just another row.
    expect(has(renderer, "plan-current-badge-plan_9")).toBe(true);
    expect(has(renderer, "plan-current-badge-plan_8")).toBe(false);
  });

  it("renders a never-trained plan without fabricating a date", async () => {
    const client = makeClient({
      fetchPlanList: vi.fn(async () =>
        ok([{ ...activePlan, completedSessions: 0, lastTrainedAt: undefined }]),
      ),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(text(renderer)).toContain("Never trained");
  });

  it("opens a ready plan on the plan-status screen, keyed by its plan id", async () => {
    const { renderer, navigation } = renderScreen();
    await settle();

    await act(async () => {
      await byId(renderer, "plan-open-plan_9").props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith("PlanStatus", { planId: "plan_9" });
  });

  it("offers no open action for a plan that is still generating or has failed", async () => {
    const client = makeClient({
      fetchPlanList: vi.fn(async () =>
        ok([
          { ...activePlan, id: "plan_gen", status: "generating" },
          { ...activePlan, id: "plan_bad", status: "failed" },
        ]),
      ),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(byId(renderer, "plan-open-plan_gen").props.disabled).toBe(true);
    expect(byId(renderer, "plan-open-plan_bad").props.disabled).toBe(true);
  });

  it("archives a row and removes it from the list without re-fetching the whole screen", async () => {
    const { renderer, client } = renderScreen();
    await settle();

    await act(async () => {
      await byId(renderer, "plan-archive-plan_8").props.onPress();
    });

    expect(client.archivePlan).toHaveBeenCalledWith("plan_8", expect.anything());
    expect(has(renderer, "plan-card-plan_8")).toBe(false);
    expect(has(renderer, "plan-card-plan_9")).toBe(true);
    // No full reload: the initial load is still the only list read.
    expect(client.fetchPlanList).toHaveBeenCalledTimes(1);
  });

  it("states that history is preserved beside the archive action", async () => {
    const { renderer } = renderScreen();
    await settle();

    expect(text(renderer)).toContain("Your workout history is kept");
  });

  it("keeps the row and surfaces an inline error when archiving fails", async () => {
    const client = makeClient({
      archivePlan: vi.fn(async () => ({
        kind: "error" as const,
        message: "not_found",
        status: 404,
      })),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    await act(async () => {
      await byId(renderer, "plan-archive-plan_8").props.onPress();
    });

    expect(has(renderer, "plans-action-error")).toBe(true);
    expect(has(renderer, "plan-card-plan_8")).toBe(true);
  });

  it("reveals archived rows in their own section when show-archived is toggled on", async () => {
    const fetchPlanList = vi
      .fn()
      .mockResolvedValueOnce(ok([activePlan]))
      .mockResolvedValueOnce(ok([activePlan, archivedPlan]));
    const { renderer } = renderScreen({ client: makeClient({ fetchPlanList }) });
    await settle();

    expect(has(renderer, "plan-card-plan_7")).toBe(false);
    expect(has(renderer, "plans-archived-section")).toBe(false);

    await act(async () => {
      await byId(renderer, "plans-show-archived").props.onPress();
    });

    expect(fetchPlanList).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeArchived: true }),
    );
    expect(has(renderer, "plans-archived-section")).toBe(true);
    expect(has(renderer, "plan-card-plan_7")).toBe(true);
    // Archived rows live below the separator, never mixed into the active list.
    expect(has(renderer, "plan-archive-plan_7")).toBe(false);
    expect(has(renderer, "plan-unarchive-plan_7")).toBe(true);
  });

  it("moves an unarchived plan back into the active list without a reload", async () => {
    const fetchPlanList = vi
      .fn()
      .mockResolvedValueOnce(ok([activePlan]))
      .mockResolvedValueOnce(ok([activePlan, archivedPlan]));
    const client = makeClient({ fetchPlanList });
    const { renderer } = renderScreen({ client });
    await settle();
    await act(async () => {
      await byId(renderer, "plans-show-archived").props.onPress();
    });

    await act(async () => {
      await byId(renderer, "plan-unarchive-plan_7").props.onPress();
    });

    expect(client.unarchivePlan).toHaveBeenCalledWith("plan_7", expect.anything());
    expect(has(renderer, "plan-archive-plan_7")).toBe(true);
    expect(has(renderer, "plan-unarchive-plan_7")).toBe(false);
    expect(fetchPlanList).toHaveBeenCalledTimes(2);
  });

  it("renders a distinguishable error state on a failed load — never an empty list", async () => {
    const fetchPlanList = vi
      .fn()
      .mockResolvedValueOnce({ kind: "error", message: "api_unreachable" })
      .mockResolvedValueOnce(ok([activePlan]));
    const { renderer } = renderScreen({ client: makeClient({ fetchPlanList }) });
    await settle();

    expect(has(renderer, "plans-load-error")).toBe(true);
    // The empty state and its create-your-first-plan CTA must NOT appear: the
    // user may well have plans we simply could not read (#378/#396).
    expect(has(renderer, "plans-empty")).toBe(false);
    expect(text(renderer)).not.toContain("No plans yet");

    await act(async () => {
      await byId(renderer, "plans-retry").props.onPress();
    });
    expect(has(renderer, "plans-load-error")).toBe(false);
    expect(has(renderer, "plan-card-plan_9")).toBe(true);
  });

  it("renders the empty state, distinct from the error state, when the user genuinely has no plans", async () => {
    const { renderer } = renderScreen({
      client: makeClient({ fetchPlanList: vi.fn(async () => ok([])) }),
    });
    await settle();

    expect(has(renderer, "plans-empty")).toBe(true);
    expect(has(renderer, "plans-load-error")).toBe(false);
    expect(text(renderer)).toContain("No plans yet");
  });

  it("routes to the create-plan flow from the empty state", async () => {
    const { renderer, navigation } = renderScreen({
      client: makeClient({ fetchPlanList: vi.fn(async () => ok([])) }),
    });
    await settle();

    await act(async () => {
      await byId(renderer, "plans-empty-cta").props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith("CreatePlanAssistant");
  });

  it("clears the session and returns to Login exactly once on an expired session", async () => {
    const client = makeClient({
      fetchPlanList: vi.fn(async () => ({
        kind: "error" as const,
        message: "unauthorized",
        status: 401,
        sessionExpired: true as const,
      })),
    });
    const { navigation, clearSession } = renderScreen({ client });
    await settle();

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("Login");
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state before the first read resolves", async () => {
    let resolveList: (r: FetchPlanListResult) => void = () => {};
    const client = makeClient({
      fetchPlanList: vi.fn(
        () =>
          new Promise<FetchPlanListResult>((resolve) => {
            resolveList = resolve;
          }),
      ),
    });
    const { renderer } = renderScreen({ client });

    expect(has(renderer, "plans-loading")).toBe(true);

    await act(async () => {
      resolveList(ok([]));
    });
    expect(has(renderer, "plans-loading")).toBe(false);
  });
});
