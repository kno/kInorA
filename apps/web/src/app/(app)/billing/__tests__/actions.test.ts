import { afterEach, describe, expect, it, vi } from "vitest";

const cookies = vi.fn();
const getBillingVisibility = vi.fn();
const getBillingInvoices = vi.fn();
const startCheckout = vi.fn();
const openPortal = vi.fn();

vi.mock("next/headers", () => ({ cookies: (...args: unknown[]) => cookies(...args) }));
vi.mock("@/auth/session-cookie", () => ({ SESSION_COOKIE: "kinora_session" }));
vi.mock("../billing-client", () => ({
  getBillingVisibility: (...args: unknown[]) => getBillingVisibility(...args),
  getBillingInvoices: (...args: unknown[]) => getBillingInvoices(...args),
  startCheckout: (...args: unknown[]) => startCheckout(...args),
  openPortal: (...args: unknown[]) => openPortal(...args),
}));

import {
  getBillingInvoicesAction,
  getBillingVisibilityAction,
  openPortalAction,
  startCheckoutAction,
} from "../actions";

afterEach(() => vi.clearAllMocks());

function withToken(token: string | undefined) {
  cookies.mockResolvedValue({ get: vi.fn(() => (token ? { value: token } : undefined)) });
}

describe("billing server actions", () => {
  it("getBillingVisibilityAction forwards the session token", async () => {
    withToken("tok-1");
    getBillingVisibility.mockResolvedValue({ kind: "ok", data: {} });

    await getBillingVisibilityAction();

    expect(getBillingVisibility).toHaveBeenCalledWith("tok-1");
  });

  it("startCheckoutAction forwards the token, cycle, and promotion code", async () => {
    withToken("tok-2");
    startCheckout.mockResolvedValue({ kind: "ok", url: "https://checkout" });

    const result = await startCheckoutAction("annual", "SAVE10");

    expect(startCheckout).toHaveBeenCalledWith("tok-2", "annual", "SAVE10");
    expect(result).toEqual({ kind: "ok", url: "https://checkout" });
  });

  it("startCheckoutAction works without a promotion code", async () => {
    withToken("tok-3");
    startCheckout.mockResolvedValue({ kind: "ok", url: "https://checkout" });

    await startCheckoutAction("monthly");

    expect(startCheckout).toHaveBeenCalledWith("tok-3", "monthly", undefined);
  });

  it("getBillingInvoicesAction forwards the session token", async () => {
    withToken("tok-inv");
    getBillingInvoices.mockResolvedValue({ kind: "ok", invoices: [] });

    const result = await getBillingInvoicesAction();

    expect(getBillingInvoices).toHaveBeenCalledWith("tok-inv");
    expect(result).toEqual({ kind: "ok", invoices: [] });
  });

  it("openPortalAction forwards the session token", async () => {
    withToken("tok-4");
    openPortal.mockResolvedValue({ kind: "ok", url: "https://portal" });

    const result = await openPortalAction();

    expect(openPortal).toHaveBeenCalledWith("tok-4");
    expect(result).toEqual({ kind: "ok", url: "https://portal" });
  });
});
