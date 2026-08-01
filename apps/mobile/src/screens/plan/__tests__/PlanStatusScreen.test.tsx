import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkoutProgram } from "@kinora/contracts";
import { resolveMessages } from "../../../i18n/locale.js";
import type {
  FetchPlanStatusResult,
  GenerateResult,
} from "../../../api/plan-status-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `react-native`'s entry point uses Flow's `import typeof` syntax Vite/Rollup
// cannot parse (no Metro/Babel transform in this Vitest env) — same constraint
// AssistantScreen.test.tsx / HomeScreen.test.tsx document. Stub the handful of
// primitives the screen uses with passthrough host elements so the REAL
// component tree (its `useIntl()` calls, state) still renders and asserts.
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
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
// (undefined outside a real RN/Expo runtime). The screen only calls
// `deleteSessionToken` on session expiry; stub it (and inject `clearSession`).
vi.mock("../../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(async () => {}),
}));

const PlanStatusScreen = (await import("../PlanStatusScreen.js")).default;

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
  plan: { id: "plan_9", status, specId: "spec_1", ...extra },
});

function makeClient(
  overrides: {
    fetchPlanStatus?: (...a: any[]) => Promise<FetchPlanStatusResult>;
    fetchLatestPlanForSpec?: (...a: any[]) => Promise<FetchPlanStatusResult>;
    regeneratePlan?: (...a: any[]) => Promise<GenerateResult>;
  } = {},
) {
  return {
    fetchPlanStatus:
      overrides.fetchPlanStatus ??
      vi.fn(async () => ok("ready", { program: program(3) })),
    fetchLatestPlanForSpec:
      overrides.fetchLatestPlanForSpec ??
      vi.fn(async () => ok("ready", { program: program(3) })),
    regeneratePlan:
      overrides.regeneratePlan ??
      vi.fn(async () => ({ kind: "ok", planId: "plan_new", status: "generating" })),
  };
}

function renderScreen(props: Record<string, unknown> = {}) {
  const navigation = { navigate: vi.fn(), reset: vi.fn(), replace: vi.fn() } as any;
  const clearSession = vi.fn(async () => {});
  const route = { params: { planId: "plan_9" }, ...(props.route as object) };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" defaultLocale="en" messages={resolveMessages("en")}>
        <PlanStatusScreen
          navigation={navigation}
          route={route}
          clearSession={clearSession}
          pollIntervalMs={1000}
          {...props}
        />
      </IntlProvider>,
    );
  });
  return { renderer, navigation, clearSession };
}

const has = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id).length > 0;
const all = (r: ReactTestRenderer, id: string) =>
  r.root.findAll((n) => n.props.testID === id);

async function settle() {
  await act(async () => {});
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PlanStatusScreen (C2 — generating/ready/failed + regenerate)", () => {
  it("renders the ready program summary (weeklySessions) after loading", async () => {
    const client = makeClient({
      fetchPlanStatus: vi.fn(async () => ok("ready", { program: program(3) })),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "plan-status-ready")).toBe(true);
    expect(all(renderer, "session-row")).toHaveLength(3);
    expect(client.fetchPlanStatus).toHaveBeenCalledWith("plan_9", expect.anything());
  });

  it("renders the failed state", async () => {
    const client = makeClient({
      fetchPlanStatus: vi.fn(async () => ok("failed")),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "plan-status-failed")).toBe(true);
  });

  it("shows generating and polls until ready", async () => {
    vi.useFakeTimers();
    const fetchPlanStatus = vi
      .fn()
      .mockResolvedValueOnce(ok("generating"))
      .mockResolvedValueOnce(ok("ready", { program: program(2) }));
    const client = makeClient({ fetchPlanStatus });
    const { renderer } = renderScreen({ client });

    // Flush the initial load (a resolved promise / microtask).
    await act(async () => {});
    expect(has(renderer, "plan-status-generating")).toBe(true);

    // Advance one poll interval → the second fetch resolves ready.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(has(renderer, "plan-status-ready")).toBe(true);
    expect(fetchPlanStatus).toHaveBeenCalledTimes(2);
  });

  it("a persistent poll-time error surfaces the error state and stops polling", async () => {
    vi.useFakeTimers();
    const fetchPlanStatus = vi
      .fn()
      .mockResolvedValueOnce(ok("generating")) // initial load
      .mockResolvedValueOnce({ kind: "error", message: "api_unreachable" }) // poll 1 — transient
      .mockResolvedValueOnce({ kind: "error", message: "api_unreachable" }); // poll 2 — persists
    const client = makeClient({ fetchPlanStatus });
    const { renderer } = renderScreen({ client });
    await act(async () => {});
    expect(has(renderer, "plan-status-generating")).toBe(true);

    // First poll failure is tolerated (transient blip) — stays generating.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(has(renderer, "plan-status-generating")).toBe(true);

    // Second consecutive failure surfaces the error state with Retry.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(has(renderer, "plan-status-error")).toBe(true);
    expect(fetchPlanStatus).toHaveBeenCalledTimes(3);

    // Polling stopped: further time advances make no more fetch calls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchPlanStatus).toHaveBeenCalledTimes(3);
  });

  it("a single transient poll error is tolerated and recovers on the next successful poll", async () => {
    vi.useFakeTimers();
    const fetchPlanStatus = vi
      .fn()
      .mockResolvedValueOnce(ok("generating")) // initial load
      .mockResolvedValueOnce({ kind: "error", message: "api_unreachable" }) // poll 1 — transient
      .mockResolvedValueOnce(ok("ready", { program: program(2) })); // poll 2 — recovers
    const client = makeClient({ fetchPlanStatus });
    const { renderer } = renderScreen({ client });
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(has(renderer, "plan-status-generating")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(has(renderer, "plan-status-ready")).toBe(true);
  });

  it("caps poll attempts and shows a terminal 'still generating' state, then Refresh restarts polling", async () => {
    vi.useFakeTimers();
    const fetchPlanStatus = vi
      .fn()
      .mockResolvedValueOnce(ok("generating")) // initial load
      .mockResolvedValueOnce(ok("generating")) // poll 1 — cap reached (max=1)
      .mockResolvedValueOnce(ok("ready", { program: program(1) })); // after Refresh
    const client = makeClient({ fetchPlanStatus });
    const { renderer } = renderScreen({ client, maxPollAttempts: 1 });
    await act(async () => {});
    expect(has(renderer, "plan-status-generating")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(has(renderer, "plan-status-stalled")).toBe(true);

    // Polling stopped at the cap: no further fetch calls while stalled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchPlanStatus).toHaveBeenCalledTimes(2);

    // Refresh restarts polling immediately.
    const refresh = renderer.root.find((n) => n.props.testID === "refresh-btn");
    await act(async () => {
      await refresh.props.onPress();
    });
    expect(has(renderer, "plan-status-ready")).toBe(true);
    expect(fetchPlanStatus).toHaveBeenCalledTimes(3);
  });

  it("regenerate → 202 transitions to generating and polls the NEW plan to ready", async () => {
    vi.useFakeTimers();
    const fetchPlanStatus = vi
      .fn()
      .mockResolvedValueOnce(ok("ready", { program: program(3) })) // initial load
      .mockResolvedValueOnce(ok("ready", { program: program(2) })); // poll of plan_new
    const regeneratePlan = vi.fn(async () => ({
      kind: "ok" as const,
      planId: "plan_new",
      status: "generating",
    }));
    const client = makeClient({ fetchPlanStatus, regeneratePlan });
    const { renderer } = renderScreen({ client });
    await act(async () => {});
    expect(has(renderer, "plan-status-ready")).toBe(true);

    const btn = renderer.root.find((n) => n.props.testID === "regenerate-btn");
    await act(async () => {
      await btn.props.onPress();
    });
    expect(regeneratePlan).toHaveBeenCalledWith("spec_1", expect.anything());
    expect(has(renderer, "plan-status-generating")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // The poll targeted the NEW plan id.
    expect(fetchPlanStatus).toHaveBeenLastCalledWith("plan_new", expect.anything());
    expect(has(renderer, "plan-status-ready")).toBe(true);
  });

  it("regenerate → 403 shows a quota message and leaves the plan on ready", async () => {
    const regeneratePlan = vi.fn(async () => ({
      kind: "error" as const,
      message: "tenant_quota_exhausted",
      status: 403,
    }));
    const client = makeClient({
      fetchPlanStatus: vi.fn(async () => ok("ready", { program: program(3) })),
      regeneratePlan,
    });
    const { renderer } = renderScreen({ client });
    await settle();

    const btn = renderer.root.find((n) => n.props.testID === "regenerate-btn");
    await act(async () => {
      await btn.props.onPress();
    });

    expect(has(renderer, "plan-status-notice")).toBe(true);
    const notice = renderer.root.find((n) => n.props.testID === "plan-status-notice");
    expect(String(notice.props.children)).toMatch(/period|upgrade/i);
    // Plan unchanged: still on the ready surface.
    expect(has(renderer, "plan-status-ready")).toBe(true);
  });

  it("sessionExpired on load clears the token and resets navigation to Login (once)", async () => {
    const client = makeClient({
      fetchPlanStatus: vi.fn(
        async (): Promise<FetchPlanStatusResult> => ({
          kind: "error",
          message: "no_session",
          sessionExpired: true,
        }),
      ),
    });
    const { renderer, navigation, clearSession } = renderScreen({ client });
    await settle();
    await settle();

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: "Login" }],
    });
    expect(renderer).toBeTruthy();
  });

  it("clears the poll interval on unmount (no further fetch, no setState after unmount)", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchPlanStatus = vi.fn().mockResolvedValue(ok("generating"));
    const client = makeClient({ fetchPlanStatus });
    const { renderer } = renderScreen({ client });
    await act(async () => {});
    expect(has(renderer, "plan-status-generating")).toBe(true);
    expect(fetchPlanStatus).toHaveBeenCalledTimes(1);

    act(() => renderer.unmount());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Interval was cleared: no extra fetch fired after unmount.
    expect(fetchPlanStatus).toHaveBeenCalledTimes(1);
    // No React "setState on unmounted component" warning.
    const warned = errorSpy.mock.calls.some((c) =>
      String(c[0]).includes("unmounted"),
    );
    expect(warned).toBe(false);
    errorSpy.mockRestore();
  });

  it("network error on load shows a graceful error state with retry", async () => {
    const fetchPlanStatus = vi
      .fn()
      .mockResolvedValueOnce({ kind: "error", message: "api_unreachable" })
      .mockResolvedValueOnce(ok("ready", { program: program(3) }));
    const client = makeClient({ fetchPlanStatus });
    const { renderer } = renderScreen({ client });
    await settle();

    expect(has(renderer, "plan-status-error")).toBe(true);
    const retry = renderer.root.find((n) => n.props.testID === "retry-btn");
    await act(async () => {
      await retry.props.onPress();
    });
    expect(has(renderer, "plan-status-ready")).toBe(true);
    expect(fetchPlanStatus).toHaveBeenCalledTimes(2);
  });
});

describe("PlanStatusScreen — trainer branding accent seam (15b-v2 S4)", () => {
  // Style props on RN "Text" host elements are arrays like
  // [styles.sessionCount, { color: accentColor }] once the accent-only theming
  // seam merges an override on top of the static token — find the merged
  // color by flattening whatever `style` shape the node carries.
  function flattenColor(style: unknown): string | undefined {
    // RN merges style arrays LEFT-TO-RIGHT, later entries winning — walk in
    // reverse so an override (appended last) is found before the base token.
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

  // `<FormattedMessage>` resolves to plain text only once react-intl actually
  // renders it — a "Text" instance's `props.children` still holds the
  // unresolved `<FormattedMessage>` element description, not the rendered
  // string. Walking the RENDERED JSON tree (`renderer.toJSON()`) sidesteps
  // that and gives the real, resolved text content — mirrors the `textOf`
  // tree-walk helper used by the web PlanWeekView tests.
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
      fetchPlanStatus: vi.fn(async () =>
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

  it("triangulation: a different accent/title/trainerName render correctly", async () => {
    const client = makeClient({
      fetchPlanStatus: vi.fn(async () =>
        ok("ready", {
          program: program(2),
          branding: { trainerName: "Coach Ben", title: "Winter Strength", accentColor: "#FF4500" },
        }),
      ),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    const text = flattenText(renderer.toJSON());
    expect(text).toContain("Winter Strength");
    expect(text).toContain("Coach Ben");

    const sessionCount = renderer.root.find((n) => n.props.testID === "ready-sessions");
    expect(flattenColor(sessionCount.props.style)).toBe("#FF4500");
  });

  it("renders the base (unbranded) plan unchanged when branding is absent", async () => {
    const client = makeClient({
      fetchPlanStatus: vi.fn(async () => ok("ready", { program: program(2) })),
    });
    const { renderer } = renderScreen({ client });
    await settle();

    // No branding byline rendered.
    expect(flattenText(renderer.toJSON())).not.toContain("By ");

    // Session count keeps the default accent token (no override applied).
    const sessionCount = renderer.root.find((n) => n.props.testID === "ready-sessions");
    expect(flattenColor(sessionCount.props.style)).toBe("#A8F060");
  });
});
