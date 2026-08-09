import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../i18n/locale.js";
import type { AdaptationRecommendation } from "@kinora/contracts";
import type { FetchDashboardResult } from "../../api/plan-status-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `react-native`'s entry point uses Flow's `import typeof` syntax Vite/Rollup
// cannot parse (no Metro/Babel transform in this Vitest env) — same constraint
// AssistantScreen.test.tsx / PlanStatusScreen.test.tsx document. Stub the
// handful of primitives HomeScreen uses with passthrough host elements so the
// REAL component tree (its `useIntl()` calls, state, dashboard fetch) still
// renders and asserts. NOTE: `TextInput` is deliberately NOT stubbed — C3
// removes the manual `workoutPlanId` paste input, so the screen must no longer
// reference it (a lingering `<TextInput>` would render `undefined` and throw).
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
  Alert: { alert: vi.fn() },
}));

// `../auth/session-storage` transitively imports `expo-secure-store` →
// `expo-modules-core`, which reads the RN global `__DEV__` at module scope —
// not defined outside a real RN/Expo runtime. HomeScreen only calls
// `deleteSessionToken` on logout / session-expiry; stub it (and inject
// `clearSession` in the sessionExpired test).
vi.mock("../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(async () => {}),
}));

const HomeScreen = (await import("../HomeScreen.js")).default;

/** Build a minimal `DashboardSummaryDTO` ok result, optionally with `adaptation`/`viewerIsTrainer`. */
const dashboard = (
  adaptation?: AdaptationRecommendation,
  viewerIsTrainer?: boolean,
): FetchDashboardResult => ({
  kind: "ok",
  summary: {
    streak: 0,
    recentDailyCompletion: [],
    weeklyCompleted: 0,
    weeklyPlanned: 0,
    weeklyRollup: [],
    ...(adaptation !== undefined ? { adaptation } : {}),
    ...(viewerIsTrainer !== undefined ? { viewerIsTrainer } : {}),
  },
});

/** A `low` adherence recommendation carrying the spec to open on the plan entry. */
const lowWithPlan = (planSpecId: string): AdaptationRecommendation => ({
  source: "adherence",
  level: "low",
  planSpecId,
  suggestedChange: { kind: "reduce_frequency", fromDays: 4, toDays: 3 },
  rationaleKey: "adaptation.adherence.reduceFrequency",
});

/** An `ok` recommendation that still carries the current ready plan's spec. */
const okWithPlan = (planSpecId: string): AdaptationRecommendation => ({
  source: "adherence",
  level: "ok",
  planSpecId,
});

/** `insufficient_data` — no ready plan, so no `planSpecId` (the no-plan case). */
const noPlan: AdaptationRecommendation = {
  source: "adherence",
  level: "insufficient_data",
};

function makeClient(
  overrides: {
    fetchDashboardSummary?: (...a: any[]) => Promise<FetchDashboardResult>;
  } = {},
) {
  return {
    fetchDashboardSummary:
      overrides.fetchDashboardSummary ??
      vi.fn(async () => dashboard(okWithPlan("spec_1"))),
  };
}

function renderScreen(props: Record<string, unknown> = {}) {
  const navigation = {
    navigate: vi.fn(),
    reset: vi.fn(),
    replace: vi.fn(),
  } as any;
  const clearSession = vi.fn(async () => {});
  // Always inject a client so no test hits the real SecureStore/network path.
  const { locale, ...rest } = props as { locale?: "en" | "es" } & Record<string, unknown>;
  const client = (rest.client as unknown) ?? makeClient();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale={locale ?? "en"} defaultLocale="en" messages={resolveMessages(locale ?? "en")}>
        <HomeScreen
          navigation={navigation}
          clearSession={clearSession}
          {...rest}
          client={client as any}
        />
      </IntlProvider>,
    );
  });
  return { renderer, navigation, clearSession };
}

const has = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id).length > 0;

async function settle() {
  await act(async () => {});
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("HomeScreen (C3 — dashboard fetch + plan-status nav entry)", () => {
  it("fetches the dashboard summary and shows a plan entry that navigates to PlanStatus with the resolved planSpecId", async () => {
    const client = makeClient({
      fetchDashboardSummary: vi.fn(async () => dashboard(lowWithPlan("spec_42"))),
    });
    const { renderer, navigation } = renderScreen({ client });
    await settle();

    expect(client.fetchDashboardSummary).toHaveBeenCalledTimes(1);
    expect(has(renderer, "home-view-plan")).toBe(true);

    const entry = renderer.root.find((n) => n.props.testID === "home-view-plan");
    await act(async () => {
      await entry.props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith("PlanStatus", {
      planSpecId: "spec_42",
    });
  });

  it("resolves the plan entry from an `ok`-level summary too (planSpecId present without a suggestion)", async () => {
    const client = makeClient({
      fetchDashboardSummary: vi.fn(async () => dashboard(okWithPlan("spec_7"))),
    });
    const { renderer, navigation } = renderScreen({ client });
    await settle();

    expect(has(renderer, "home-view-plan")).toBe(true);
    const entry = renderer.root.find((n) => n.props.testID === "home-view-plan");
    await act(async () => {
      await entry.props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith("PlanStatus", {
      planSpecId: "spec_7",
    });
  });

  it("shows a no-plan empty state (no crash, no plan entry) when the summary carries no planSpecId", async () => {
    const client = makeClient({
      fetchDashboardSummary: vi.fn(async () => dashboard(noPlan)),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "home-no-plan")).toBe(true);
    expect(has(renderer, "home-view-plan")).toBe(false);
  });

  it("degrades gracefully to an error+retry state when the summary fetch fails, then recovers on retry", async () => {
    const fetchDashboardSummary = vi
      .fn()
      .mockResolvedValueOnce({ kind: "error", message: "api_unreachable" })
      .mockResolvedValueOnce(dashboard(lowWithPlan("spec_9")));
    const client = makeClient({ fetchDashboardSummary });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "home-error")).toBe(true);
    const retry = renderer.root.find((n) => n.props.testID === "home-retry");
    await act(async () => {
      await retry.props.onPress();
    });
    expect(has(renderer, "home-view-plan")).toBe(true);
    expect(fetchDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it("clears the session and resets navigation to Login exactly once on a sessionExpired fetch", async () => {
    const client = makeClient({
      fetchDashboardSummary: vi.fn(async () => ({
        kind: "error" as const,
        message: "no_session",
        sessionExpired: true as const,
      })),
    });
    const { navigation, clearSession } = renderScreen({ client });
    await settle();
    await settle();

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: "Login" }],
    });
  });

  it("no longer renders the manual workoutPlanId paste affordance (no TextInput, no 'Start workout')", async () => {
    const { renderer } = renderScreen();
    await settle();

    // The removed `<TextInput>` primitive is not even stubbed in this test's
    // react-native mock — a lingering reference would have thrown on render.
    const inputs = renderer.root.findAll(
      (n) => (n.type as unknown) === "TextInput",
    );
    expect(inputs).toHaveLength(0);
    const startWorkout = renderer.root.findAll(
      (n) =>
        typeof n.props.children === "string" &&
        /start workout/i.test(n.props.children),
    );
    expect(startWorkout).toHaveLength(0);
  });

  it("keeps i18n wiring: renders the logout control via useIntl (EN) and navigates to History", async () => {
    const { renderer, navigation } = renderScreen();
    await settle();

    const logout = renderer.root.findAllByProps({ children: "Log out" });
    expect(logout.length).toBeGreaterThan(0);

    const historyButton = renderer.root.find(
      (n) => n.props.accessibilityLabel === "History",
    );
    historyButton.props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith("History");
  });

  it("renders the ES logout translation under the es locale", async () => {
    const { renderer } = renderScreen({ locale: "es" });
    await settle();

    const logout = renderer.root.findAllByProps({ children: "Cerrar sesión" });
    expect(logout.length).toBeGreaterThan(0);
  });

  it("navigates to Profile when the Profile nav entry is pressed", async () => {
    const { renderer, navigation } = renderScreen();
    await settle();

    const profileButton = renderer.root.find(
      (n) => n.props.accessibilityLabel === "Profile",
    );
    profileButton.props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith("Profile");
  });

  // 17d PR C: the plans list is reachable from the hub. Native has no tab bar,
  // so `HomeScreen`'s secondary menu is the nav seam — the same placement web
  // chose when it put /plans in `MobileNav.SECONDARY_TABS` rather than adding a
  // fourth primary tab.
  it("navigates to the Plans list when the Plans nav entry is pressed", async () => {
    const { renderer, navigation } = renderScreen();
    await settle();

    const plansButton = renderer.root.find((n) => n.props.testID === "home-plans");
    plansButton.props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith("Plans");
  });

  it("leaves the existing plan entry into PlanStatus untouched by the Plans entry", async () => {
    const client = makeClient({
      fetchDashboardSummary: vi.fn(async () => dashboard(okWithPlan("spec_5"))),
    });
    const { renderer, navigation } = renderScreen({ client });
    await settle();

    expect(has(renderer, "home-plans")).toBe(true);
    const entry = renderer.root.find((n) => n.props.testID === "home-view-plan");
    await act(async () => {
      await entry.props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith("PlanStatus", {
      planSpecId: "spec_5",
    });
  });

  // 15b/#294: the Clients/Trainer-plan nav entries are trainer-only, gated on
  // the dashboard summary's `viewerIsTrainer` (attached by the API from the
  // authenticated membership role — no extra request).
  it("shows the Clients and Trainer-plan nav entries when the viewer is a trainer", async () => {
    const client = makeClient({
      fetchDashboardSummary: vi.fn(async () => dashboard(okWithPlan("spec_1"), true)),
    });
    const { renderer, navigation } = renderScreen({ client });
    await settle();

    const clientsButton = renderer.root.find(
      (n) => n.props.accessibilityLabel === "Clients",
    );
    clientsButton.props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith("ClientList");

    const trainerPlanButton = renderer.root.find(
      (n) => n.props.accessibilityLabel === "My trainer's plan",
    );
    trainerPlanButton.props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith("TrainerPlan");
  });

  it("hides the Clients and Trainer-plan nav entries (but keeps Create-plan/History/Logout) when the viewer is not a trainer", async () => {
    const client = makeClient({
      fetchDashboardSummary: vi.fn(async () => dashboard(okWithPlan("spec_1"), false)),
    });
    const { renderer, navigation } = renderScreen({ client });
    await settle();

    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === "Clients"),
    ).toHaveLength(0);
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === "My trainer's plan"),
    ).toHaveLength(0);

    const createPlanButton = renderer.root.find(
      (n) => n.props.accessibilityLabel === "Create your plan by chatting",
    );
    expect(createPlanButton).toBeTruthy();

    const historyButton = renderer.root.find(
      (n) => n.props.accessibilityLabel === "History",
    );
    historyButton.props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith("History");

    const logoutButton = renderer.root.find(
      (n) => n.props.accessibilityLabel === "Log out",
    );
    expect(logoutButton).toBeTruthy();
  });

  it("#294: renders the ready state in a ScrollView so the growing menu never overflows", async () => {
    const { renderer } = renderScreen();
    await settle();

    const ready = renderer.root.find((n) => n.props.testID === "home-ready");
    expect(ready.type).toBe("ScrollView");
  });
});
