// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type { BillingVisibilityDTO } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { BillingPageClient } from "../BillingPageClient.js";

const getBillingVisibilityAction = vi.fn();

vi.mock("../actions.js", () => ({
  getBillingVisibilityAction: (...args: unknown[]) => getBillingVisibilityAction(...args),
}));

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const FREE_ACTIVE: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-1" as never,
    tier: "free",
    status: "active",
    source: "backfill",
    trialStartedAt: null,
    trialEndsAt: null,
    activeOverrideEndsAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  tenantUsage: [{ feature: "plan_generation", period: "2026-07", used: 1, limit: 1 }],
  memberUsage: [{ userId: "user-1" as never, feature: "plan_generation", period: "2026-07", used: 1, limit: 1 }],
  denialReason: "premium_required",
  upgradePromptPath: "/billing",
};

const TRIALING: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-2" as never,
    tier: "pro",
    status: "trialing",
    source: "system",
    trialStartedAt: "2026-06-28T00:00:00.000Z",
    trialEndsAt: "2026-07-28T00:00:00.000Z",
    activeOverrideEndsAt: null,
    updatedAt: "2026-06-28T00:00:00.000Z",
  },
  tenantUsage: [],
  memberUsage: [],
};

// FIX 2 (review correction): a trial whose STORED status is still 'trialing'
// but whose trialEndsAt has already lapsed — the API never flips the stored
// status; only the DYNAMICALLY resolved tier/denialReason reflect expiry
// (tier is already 'free', denialReason is 'trial_expired'). The trial badge
// must NOT render alongside the "trial ended" copy for this shape.
const EXPIRED_TRIALING: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-3" as never,
    tier: "free",
    status: "trialing",
    source: "system",
    trialStartedAt: "2020-01-01T00:00:00.000Z",
    trialEndsAt: "2020-01-31T00:00:00.000Z",
    activeOverrideEndsAt: null,
    updatedAt: "2020-01-31T00:00:00.000Z",
  },
  tenantUsage: [],
  memberUsage: [],
  denialReason: "trial_expired",
  upgradePromptPath: "/billing",
};

describe("BillingPageClient", () => {
  it("renders tier, status, and usage rows from initial data", () => {
    renderWithIntl(<BillingPageClient initialData={FREE_ACTIVE} />);

    expect(screen.getByRole("heading", { name: "Billing" })).toBeDefined();
    expect(screen.getByText("Free")).toBeDefined();
    expect(screen.getByText(/Active/)).toBeDefined();
  });

  it("shows an upgrade prompt when denialReason is present", () => {
    renderWithIntl(<BillingPageClient initialData={FREE_ACTIVE} />);

    expect(screen.getByRole("link", { name: /upgrade/i })).toBeDefined();
  });

  it("shows the trial badge with tier Pro and no upgrade prompt while trialing", () => {
    renderWithIntl(<BillingPageClient initialData={TRIALING} />);

    expect(screen.getByText("Pro")).toBeDefined();
    expect(screen.queryByRole("link", { name: /upgrade/i })).toBeNull();
  });

  it("shows ONLY the trial-ended copy for an expired trial — never the active-trial badge", () => {
    renderWithIntl(<BillingPageClient initialData={EXPIRED_TRIALING} />);

    expect(screen.getByText("Your Pro trial has ended")).toBeDefined();
    expect(screen.queryByText(/Pro trial — /i)).toBeNull();
    expect(screen.queryByText(/day(s)? left/i)).toBeNull();
  });

  it("shows an empty-usage message when no usage has been recorded yet", () => {
    renderWithIntl(<BillingPageClient initialData={TRIALING} />);

    expect(screen.getByText(/No usage recorded yet/i)).toBeDefined();
  });

  it("renders an accessible error state with a focused retry button when initial load failed and online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    renderWithIntl(<BillingPageClient initialData={null} initialError="server_error" />);

    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeDefined();
    expect(document.activeElement).toBe(retry);
  });

  it("renders an offline state when the load failed while offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    renderWithIntl(<BillingPageClient initialData={null} initialError="api_unreachable" />);

    expect(screen.getByText(/offline/i)).toBeDefined();
  });

  it("switches from error to offline (and back) when the browser's connectivity changes live", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    renderWithIntl(<BillingPageClient initialData={null} initialError="api_unreachable" />);

    // Started online with an api_unreachable error → the error card, not offline.
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    expect(screen.queryByText(/offline/i)).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    // The live `offline` listener flips state → now shows the offline card.
    expect(screen.getByText(/offline/i)).toBeDefined();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    // The live `online` listener flips back → offline card gone, error card returns.
    expect(screen.queryByText(/offline/i)).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("shows the bootstrap empty state when there is no data and no error yet", () => {
    renderWithIntl(<BillingPageClient initialData={null} />);

    expect(screen.getByText("No billing data yet.")).toBeDefined();
    expect(
      screen.getByText("Billing details will appear here once your tenant's plan is set up."),
    ).toBeDefined();
  });

  it("re-shows the error state when a retry itself fails", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    getBillingVisibilityAction.mockResolvedValue({ kind: "error", message: "server_error" });
    renderWithIntl(<BillingPageClient initialData={null} initialError="server_error" />);

    const retry = screen.getByRole("button", { name: /retry/i });
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(getBillingVisibilityAction).toHaveBeenCalledTimes(1));
    // Still in the error state — the failed retry did not fabricate data.
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  // #176 — a failed client refetch must be observable, not silently swallowed.
  it("logs a structured telemetry event when a refetch fails (#176)", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    getBillingVisibilityAction.mockResolvedValue({ kind: "error", message: "server_error" });
    renderWithIntl(<BillingPageClient initialData={null} initialError="server_error" />);

    const retry = screen.getByRole("button", { name: /retry/i });
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "billing_visibility_refresh_failed",
          kind: "server_error",
        }),
      ),
    );
  });

  it("does NOT log a telemetry event when a refresh succeeds (#176)", async () => {
    getBillingVisibilityAction.mockResolvedValue({ kind: "ok", data: TRIALING });
    renderWithIntl(<BillingPageClient initialData={FREE_ACTIVE} />);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Pro")).toBeDefined());
    const refreshFailureCalls = consoleErrorSpy.mock.calls.filter(
      ([obj]) => (obj as { event?: string })?.event === "billing_visibility_refresh_failed",
    );
    expect(refreshFailureCalls).toHaveLength(0);
  });

  it("shows an accessible loading indicator while retrying", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    let resolveRetry: (value: { kind: "ok"; data: BillingVisibilityDTO }) => void = () => {};
    getBillingVisibilityAction.mockReturnValue(
      new Promise((resolve) => {
        resolveRetry = resolve;
      }),
    );
    renderWithIntl(<BillingPageClient initialData={null} initialError="server_error" />);

    const retry = screen.getByRole("button", { name: /retry/i });
    act(() => {
      retry.click();
    });

    expect(screen.getByRole("progressbar")).toBeDefined();

    await act(async () => {
      resolveRetry({ kind: "ok", data: FREE_ACTIVE });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Free")).toBeDefined());
  });

  it("refreshes billing data from the new tenant only when the tab regains focus (tenant switch)", async () => {
    getBillingVisibilityAction.mockResolvedValue({ kind: "ok", data: TRIALING });
    renderWithIntl(<BillingPageClient initialData={FREE_ACTIVE} />);

    expect(screen.getByText("Free")).toBeDefined();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Pro")).toBeDefined());
    // The stale Free-tenant usage row must be gone — replaced, not merged.
    expect(screen.queryByText("Free")).toBeNull();
  });

  it("collapses a focus+visibilitychange double-activation into exactly one fetch (FIX 3)", async () => {
    let resolveFetch: (value: { kind: "ok"; data: BillingVisibilityDTO }) => void = () => {};
    getBillingVisibilityAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderWithIntl(<BillingPageClient initialData={FREE_ACTIVE} />);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      // Both listeners fire near-simultaneously, as they do on a real tab
      // focus event (focus + visibilitychange fire together).
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    // A second activation while the first is still in flight must NOT queue
    // another concurrent fetch — at most one fetch is in flight at a time.
    expect(getBillingVisibilityAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch({ kind: "ok", data: TRIALING });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Pro")).toBeDefined());
    expect(getBillingVisibilityAction).toHaveBeenCalledTimes(1);
  });
});
