import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../i18n/locale.js";
import type { AdaptationRecommendation } from "@kinora/contracts";
import type { GenerateResult } from "../../api/plan-status-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `react-native`'s entry point uses Flow's `import typeof` syntax Vite/Rollup
// cannot parse (no Metro/Babel transform in this Vitest env) — same constraint
// HomeScreen.test.tsx / PlanStatusScreen.test.tsx document. Stub the handful of
// primitives the banner uses with passthrough host elements so the REAL
// component tree (its `useIntl()` calls, state, accept flow) still renders.
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: ({ children, style, onPress, ...rest }: any) => (
    <button type="button" onClick={onPress} {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
}));

// `../auth/session-storage` transitively imports `expo-secure-store` →
// `expo-modules-core`, which reads the RN global `__DEV__` at module scope
// (undefined outside a real RN/Expo runtime). The banner only calls
// `deleteSessionToken` on session expiry; stub it (and inject `clearSession`).
vi.mock("../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(async () => {}),
}));

const AdherenceBanner = (await import("../AdherenceBanner.js")).default;

/** A `low` adherence recommendation with a real frequency reduction (4 → 3). */
const low = (planSpecId = "spec_1"): AdaptationRecommendation => ({
  source: "adherence",
  level: "low",
  planSpecId,
  suggestedChange: { kind: "reduce_frequency", fromDays: 4, toDays: 3 },
  rationaleKey: "adaptation.adherence.reduceFrequency",
});

const ok: AdaptationRecommendation = {
  source: "adherence",
  level: "ok",
  planSpecId: "spec_1",
};

const insufficient: AdaptationRecommendation = {
  source: "adherence",
  level: "insufficient_data",
};

/** A `low` at the floor (daysPerWeek=1) → no actionable `suggestedChange`. */
const lowNoChange: AdaptationRecommendation = {
  source: "adherence",
  level: "low",
  planSpecId: "spec_1",
};

function renderBanner(props: Record<string, unknown> = {}) {
  const navigation = { navigate: vi.fn(), reset: vi.fn(), replace: vi.fn() } as any;
  const clearSession = vi.fn(async () => {});
  const adaptPlan =
    (props.adaptPlan as any) ??
    vi.fn(async (): Promise<GenerateResult> => ({
      kind: "ok",
      planId: "plan_new",
      status: "generating",
    }));
  const { locale, adaptation, ...rest } = props as {
    locale?: "en" | "es";
    adaptation?: AdaptationRecommendation;
  } & Record<string, unknown>;
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider
        locale={locale ?? "en"}
        defaultLocale="en"
        messages={resolveMessages(locale ?? "en")}
      >
        <AdherenceBanner
          navigation={navigation}
          clearSession={clearSession}
          adaptPlan={adaptPlan}
          adaptation={adaptation ?? low()}
          {...rest}
        />
      </IntlProvider>,
    );
  });
  return { renderer, navigation, clearSession, adaptPlan };
}

const has = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id).length > 0;

const press = async (r: ReactTestRenderer, id: string) => {
  const node = r.root.find((n) => n.props.testID === id);
  await act(async () => {
    await node.props.onPress();
  });
};

async function settle() {
  await act(async () => {});
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdherenceBanner (D1 — mobile adherence suggestion banner)", () => {
  it("renders the banner with a from→to suggestion only on level 'low' + suggestedChange", () => {
    const { renderer } = renderBanner({ adaptation: low() });
    expect(has(renderer, "adherence-banner")).toBe(true);
    // "Want to try 3 days per week instead of 4?"
    const suggestion = renderer.root.findAll(
      (n) =>
        typeof n.props.children === "string" &&
        /3 days per week instead of 4/.test(n.props.children),
    );
    expect(suggestion.length).toBeGreaterThan(0);
  });

  it("renders nothing on level 'ok'", () => {
    const { renderer } = renderBanner({ adaptation: ok });
    expect(has(renderer, "adherence-banner")).toBe(false);
  });

  it("renders nothing on level 'insufficient_data'", () => {
    const { renderer } = renderBanner({ adaptation: insufficient });
    expect(has(renderer, "adherence-banner")).toBe(false);
  });

  it("renders nothing on a 'low' with no actionable suggestedChange (floor)", () => {
    const { renderer } = renderBanner({ adaptation: lowNoChange });
    expect(has(renderer, "adherence-banner")).toBe(false);
  });

  it("accept calls adaptPlan(planSpecId) — never sending a target frequency", async () => {
    const adaptPlan = vi.fn(async (_specId: string): Promise<GenerateResult> => ({
      kind: "ok",
      planId: "plan_new",
      status: "generating",
    }));
    const { renderer } = renderBanner({ adaptation: low("spec_42"), adaptPlan });
    await press(renderer, "adherence-accept");
    expect(adaptPlan).toHaveBeenCalledTimes(1);
    expect(adaptPlan.mock.calls[0]?.[0]).toBe("spec_42");
  });

  it("on 202 reflects a regenerating state and navigates to PlanStatus polling the new plan", async () => {
    const adaptPlan = vi.fn(async (): Promise<GenerateResult> => ({
      kind: "ok",
      planId: "plan_new",
      status: "generating",
    }));
    const { renderer, navigation } = renderBanner({
      adaptation: low("spec_42"),
      adaptPlan,
    });
    await press(renderer, "adherence-accept");
    expect(navigation.navigate).toHaveBeenCalledWith("PlanStatus", {
      planId: "plan_new",
    });
    expect(has(renderer, "adherence-regenerating")).toBe(true);
  });

  it("maps 403 to the quota-exhausted copy and leaves the plan unchanged (no navigate)", async () => {
    const adaptPlan = vi.fn(async (): Promise<GenerateResult> => ({
      kind: "error",
      message: "tenant_quota_exhausted",
      status: 403,
    }));
    const { renderer, navigation } = renderBanner({ adaptPlan });
    await press(renderer, "adherence-accept");
    expect(navigation.navigate).not.toHaveBeenCalled();
    const err = renderer.root.find((n) => n.props.testID === "adherence-error");
    expect(err.props.children).toMatch(/used your plan change/i);
  });

  it("maps 409 (no_adaptation) to the up-to-date copy", async () => {
    const adaptPlan = vi.fn(async (): Promise<GenerateResult> => ({
      kind: "error",
      message: "no_adaptation",
      status: 409,
    }));
    const { renderer, navigation } = renderBanner({ adaptPlan });
    await press(renderer, "adherence-accept");
    expect(navigation.navigate).not.toHaveBeenCalled();
    const err = renderer.root.find((n) => n.props.testID === "adherence-error");
    expect(err.props.children).toMatch(/already looks like a good fit/i);
  });

  it("maps a network/unknown error to the generic error copy", async () => {
    const adaptPlan = vi.fn(async (): Promise<GenerateResult> => ({
      kind: "error",
      message: "api_unreachable",
    }));
    const { renderer } = renderBanner({ adaptPlan });
    await press(renderer, "adherence-accept");
    const err = renderer.root.find((n) => n.props.testID === "adherence-error");
    expect(err.props.children).toMatch(/couldn't adjust your plan/i);
  });

  it("dismiss hides the banner and makes no request", async () => {
    const adaptPlan = vi.fn();
    const { renderer } = renderBanner({ adaptPlan });
    await press(renderer, "adherence-dismiss");
    expect(has(renderer, "adherence-banner")).toBe(false);
    expect(adaptPlan).not.toHaveBeenCalled();
  });

  it("disables accept while in flight — a rapid double-tap sends exactly one adaptPlan", async () => {
    let resolve!: (v: GenerateResult) => void;
    const adaptPlan = vi.fn(
      () =>
        new Promise<GenerateResult>((r) => {
          resolve = r;
        }),
    );
    const { renderer } = renderBanner({ adaptPlan });
    const accept = renderer.root.find((n) => n.props.testID === "adherence-accept");

    await act(async () => {
      // Two synchronous taps before the first request settles.
      void accept.props.onPress();
      void accept.props.onPress();
    });
    expect(adaptPlan).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ kind: "ok", planId: "plan_new", status: "generating" });
    });
  });

  it("on a sessionExpired accept, clears the session and resets to Login exactly once", async () => {
    const adaptPlan = vi.fn(async (): Promise<GenerateResult> => ({
      kind: "error",
      message: "no_session",
      status: 401,
      sessionExpired: true,
    }));
    const { renderer, navigation, clearSession } = renderBanner({ adaptPlan });
    await press(renderer, "adherence-accept");
    await settle();

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: "Login" }],
    });
  });
});
