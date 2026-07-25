import { describe, expect, it, vi } from "vitest";

const getBillingVisibility = vi.fn();
const getBillingPricing = vi.fn();
const getBillingInvoices = vi.fn();
const cookies = vi.fn();

vi.mock("next/headers", () => ({ cookies: (...args: unknown[]) => cookies(...args) }));

vi.mock("../billing-client", () => ({
  getBillingVisibility: (...args: unknown[]) => getBillingVisibility(...args),
  getBillingPricing: (...args: unknown[]) => getBillingPricing(...args),
  getBillingInvoices: (...args: unknown[]) => getBillingInvoices(...args),
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

const PRICING = {
  currency: "eur",
  monthly: { cycle: "monthly", amountPerMonth: 999, amountPerInterval: 999 },
  annual: { cycle: "annual", amountPerMonth: 799, amountPerInterval: 9588 },
  annualSavePercent: 20,
};

function client(page: { props: { children: { props: Record<string, unknown> } } }) {
  return page.props.children.props;
}

describe("BillingPage", () => {
  it("fetches visibility, pricing, and invoices server-side and threads them to the client", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    getBillingVisibility.mockResolvedValue({ kind: "ok", data: VISIBILITY });
    getBillingPricing.mockResolvedValue({ kind: "ok", data: PRICING });
    getBillingInvoices.mockResolvedValue({ kind: "ok", invoices: [] });

    const page = await BillingPage();
    const props = client(page);

    expect(getBillingVisibility).toHaveBeenCalledWith("session-token");
    expect(getBillingPricing).toHaveBeenCalledWith("session-token");
    expect(getBillingInvoices).toHaveBeenCalledWith("session-token");
    expect(props.initialError).toBeNull();
    expect(props.initialData).toEqual(VISIBILITY);
    expect(props.pricing).toEqual(PRICING);
    expect(props.initialInvoices).toEqual({ kind: "ok", invoices: [] });
  });

  it("passes a safe initial error and null pricing when the server loads fail", async () => {
    cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    getBillingVisibility.mockResolvedValue({ kind: "error", message: "api_unreachable" });
    getBillingPricing.mockResolvedValue({ kind: "error", message: "api_unreachable" });
    getBillingInvoices.mockResolvedValue({ kind: "forbidden" });

    const page = await BillingPage();
    const props = client(page);

    expect(props.initialData).toBeNull();
    expect(props.initialError).toBe("api_unreachable");
    expect(props.pricing).toBeNull();
    expect(props.initialInvoices).toEqual({ kind: "forbidden" });
  });
});
