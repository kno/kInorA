import { describe, expect, it, vi } from "vitest";

const getBillingVisibility = vi.fn();
const cookies = vi.fn();
vi.mock("next-intl/server", () => ({
  getTranslations: async () => ((key: string) => ({
    "billing.title": "Billing",
    "billing.description": "Review your plan, trial status, and usage for this account.",
  })[key] ?? key),
}));

vi.mock("next/headers", () => ({ cookies: (...args: unknown[]) => cookies(...args) }));

vi.mock("../billing-client", () => ({
  getBillingVisibility: (...args: unknown[]) => getBillingVisibility(...args),
}));

import BillingPage from "../page";

const VISIBILITY = {
  billing: {
    tenantId: "tenant-1",
    tier: "free",
    status: "active",
    source: "backfill",
    trialStartedAt: null,
    trialEndsAt: null,
    activeOverrideEndsAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  tenantUsage: [],
  memberUsage: [],
};

describe("BillingPage", () => {
  it("renders the page copy and passes fetched billing data to the client component", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    getBillingVisibility.mockResolvedValue({ kind: "ok", data: VISIBILITY });

    const page = await BillingPage();
    const billingClient = page.props.children[2];

    expect(page.props.className).toContain("kin-page");
    expect(billingClient.props.initialError).toBeNull();
    expect(billingClient.props.initialData).toEqual(VISIBILITY);
  });

  it("passes a safe initial error when the server load fails", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    getBillingVisibility.mockResolvedValue({ kind: "error", message: "api_unreachable" });

    const page = await BillingPage();
    const billingClient = page.props.children[2];

    expect(billingClient.props.initialData).toBeNull();
    expect(billingClient.props.initialError).toBe("api_unreachable");
  });
});
