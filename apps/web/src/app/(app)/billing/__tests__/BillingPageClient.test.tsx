// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type { BillingPricingDTO, BillingVisibilityDTO, InvoiceDTO } from "@kinora/contracts";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { BillingPageClient } from "../BillingPageClient.js";
import type { GetBillingInvoicesResult } from "../billing-client";

const getBillingVisibilityAction = vi.fn();
const getBillingInvoicesAction = vi.fn();
const startCheckoutAction = vi.fn();
const openPortalAction = vi.fn();

vi.mock("../actions.js", () => ({
  getBillingVisibilityAction: (...a: unknown[]) => getBillingVisibilityAction(...a),
  getBillingInvoicesAction: (...a: unknown[]) => getBillingInvoicesAction(...a),
  startCheckoutAction: (...a: unknown[]) => startCheckoutAction(...a),
  openPortalAction: (...a: unknown[]) => openPortalAction(...a),
}));

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // jsdom's window.location.assign is not spy-able; stub the whole location.
  assignSpy = vi.fn();
  vi.stubGlobal("location", { href: "http://localhost/billing", assign: assignSpy });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const PRICING: BillingPricingDTO = {
  currency: "eur",
  monthly: { cycle: "monthly", amountPerMonth: 999, amountPerInterval: 999 },
  annual: { cycle: "annual", amountPerMonth: 799, amountPerInterval: 9588 },
  annualSavePercent: 20,
};

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

const PRO_ACTIVE: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-2" as never,
    tier: "pro",
    status: "active",
    source: "stripe",
    trialStartedAt: null,
    trialEndsAt: null,
    activeOverrideEndsAt: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
    billingCycle: "monthly",
    currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
  },
  tenantUsage: [
    { feature: "plan_generation", period: "2026-07", used: 10, limit: 500 },
    { feature: "memory_write", period: "2026-07", used: 200, limit: 50000 },
  ],
  memberUsage: [
    { userId: "user-1" as never, feature: "plan_generation", period: "2026-07", used: 4, limit: 500 },
  ],
};

const TRIALING: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-3" as never,
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

// An expired Pro TRIAL — resolved to Free with the trial-expired denial reason.
const EXPIRED_TRIAL: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-4" as never,
    tier: "free",
    status: "expired",
    source: "system",
    trialStartedAt: "2026-06-01T00:00:00.000Z",
    trialEndsAt: "2026-07-01T00:00:00.000Z",
    activeOverrideEndsAt: null,
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  tenantUsage: [],
  memberUsage: [],
  denialReason: "trial_expired",
  upgradePromptPath: "/billing",
};

// A canceled/ended PAID subscription — resolved to Free with subscription_ended.
const CANCELED_SUB: BillingVisibilityDTO = {
  billing: {
    tenantId: "tenant-5" as never,
    tier: "free",
    status: "expired",
    source: "stripe",
    trialStartedAt: null,
    trialEndsAt: null,
    activeOverrideEndsAt: null,
    updatedAt: "2026-07-10T00:00:00.000Z",
    billingCycle: "monthly",
    currentPeriodEnd: "2026-07-10T00:00:00.000Z",
    cancelAtPeriodEnd: true,
  },
  tenantUsage: [],
  memberUsage: [],
  denialReason: "subscription_ended",
  upgradePromptPath: "/billing",
};

const INVOICES: InvoiceDTO[] = [
  {
    id: "in_1",
    amountDue: 999,
    currency: "eur",
    status: "paid",
    createdAt: "2026-07-01T00:00:00.000Z",
    hostedInvoiceUrl: "https://stripe.test/i/1",
    receiptUrl: "https://stripe.test/r/1",
    cardBrand: "visa",
    cardLast4: "4242",
  },
];

const OWNER_INVOICES: GetBillingInvoicesResult = { kind: "ok", invoices: INVOICES };
const OWNER_NO_INVOICES: GetBillingInvoicesResult = { kind: "ok", invoices: [] };
const NON_OWNER: GetBillingInvoicesResult = { kind: "forbidden" };
const INVOICE_ERROR: GetBillingInvoicesResult = { kind: "error", message: "server_error" };

function renderClient(
  overrides: Partial<Parameters<typeof BillingPageClient>[0]> = {},
) {
  return renderWithIntl(
    <BillingPageClient
      initialData={overrides.initialData !== undefined ? overrides.initialData : FREE_ACTIVE}
      initialError={overrides.initialError ?? null}
      pricing={overrides.pricing !== undefined ? overrides.pricing : PRICING}
      initialInvoices={overrides.initialInvoices ?? OWNER_NO_INVOICES}
    />,
  );
}

describe("BillingPageClient — OD layout", () => {
  it("renders the main + aside regions of the Open Design layout", () => {
    renderClient({ initialData: PRO_ACTIVE });
    expect(screen.getByRole("region", { name: /billing overview/i })).toBeDefined();
    expect(screen.getByRole("complementary", { name: /plan options/i })).toBeDefined();
  });

  it("renders tier, status, and the plan hero", () => {
    renderClient({ initialData: PRO_ACTIVE });
    expect(screen.getByRole("heading", { name: "Billing" })).toBeDefined();
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
    expect(screen.getByText("Current plan")).toBeDefined();
  });

  // e2e fix (#179 CI failure): "Pro" renders in MULTIPLE places (topbar tier
  // chip + PlanHero title) — assert the stable testids Playwright now targets
  // each resolve to a single element with the expected text.
  it("exposes stable testids for the tier/status chips and plan hero (unambiguous e2e targets)", () => {
    renderClient({ initialData: PRO_ACTIVE });
    expect(screen.getByTestId("billing-tier-chip").textContent).toBe("Pro");
    expect(screen.getByTestId("billing-status-chip").textContent).toBe("Active");
    expect(screen.getByTestId("billing-plan-hero")).toBeDefined();
  });

  it("shows the trial badge while trialing", () => {
    renderClient({ initialData: TRIALING });
    expect(screen.getByText(/Pro trial —/i)).toBeDefined();
  });

  it("exposes a testid for the trial badge with the expected content while trialing", () => {
    renderClient({ initialData: TRIALING });
    expect(screen.getByTestId("billing-trial-badge").textContent).toMatch(/Pro trial/);
  });

  // FIX 1 (4R review): the Price tile and the Current-period tile must show
  // DISTINCT, meaningful values — never both rendering the cycle word.
  it("shows the formatted price in the Price tile and a real period (not the cycle word) in Current period", () => {
    renderClient({ initialData: PRO_ACTIVE });

    const priceLabel = screen.getByText("Price");
    const priceValue = priceLabel.nextElementSibling as HTMLElement;
    expect(priceValue.textContent).toMatch(/9[.,]99/);
    expect(priceValue.textContent).not.toMatch(/^Monthly$|^Annual$/);

    const periodLabel = screen.getByText("Current period");
    const periodValue = periodLabel.nextElementSibling as HTMLElement;
    expect(periodValue.textContent).toBe("2026-07");
    expect(periodValue.textContent).not.toMatch(/^Monthly$|^Annual$/);

    // The two tiles must never render identical content.
    expect(priceValue.textContent).not.toBe(periodValue.textContent);
  });

  it("shows a trial-end placeholder in Current period when no usage rows or period end exist", () => {
    renderClient({ initialData: TRIALING });
    const periodLabel = screen.getByText("Current period");
    const periodValue = periodLabel.nextElementSibling as HTMLElement;
    expect(periodValue.textContent).toBe("Trial ends 2026-07-28");
  });
});

describe("BillingPageClient — access-ended upgrade surface (#198)", () => {
  it("renders the trial-ended banner with an upgrade CTA when the trial has expired", () => {
    renderClient({ initialData: EXPIRED_TRIAL });
    const banner = screen.getByTestId("billing-access-ended");
    expect(banner.textContent).toMatch(/Your Pro trial has ended/i);
    const cta = screen.getByRole("link", { name: /view upgrade options/i });
    expect(cta).toBeDefined();
  });

  it("renders the subscription-ended banner (NOT trial copy) with an upgrade CTA for a canceled paid sub", () => {
    renderClient({ initialData: CANCELED_SUB });
    const banner = screen.getByTestId("billing-access-ended");
    expect(banner.textContent).toMatch(/Your Pro subscription has ended/i);
    // Must NOT show trial-ended copy for a canceled paid subscription.
    expect(banner.textContent).not.toMatch(/trial has ended/i);
    expect(screen.getByRole("link", { name: /view upgrade options/i })).toBeDefined();
  });

  it("does NOT render the access-ended banner for an active Pro plan", () => {
    renderClient({ initialData: PRO_ACTIVE });
    expect(screen.queryByTestId("billing-access-ended")).toBeNull();
    expect(screen.queryByText(/Your Pro trial has ended/i)).toBeNull();
    expect(screen.queryByText(/Your Pro subscription has ended/i)).toBeNull();
  });

  it("does NOT render the access-ended banner during an active, unexpired trial", () => {
    renderClient({ initialData: TRIALING });
    expect(screen.queryByTestId("billing-access-ended")).toBeNull();
  });
});

describe("BillingPageClient — usage meters (metered caps, never unlimited)", () => {
  it("renders per-feature meters showing used / limit from the real Pro caps", () => {
    renderClient({ initialData: PRO_ACTIVE });
    const meters = screen.getAllByRole("meter");
    expect(meters.length).toBeGreaterThan(0);
    expect(screen.getByText("10/500")).toBeDefined();
    expect(screen.getByText("200/50000")).toBeDefined();
  });

  it("uses metered 'up to N/mo' copy and NEVER the word unlimited/ilimitado", () => {
    renderClient({ initialData: PRO_ACTIVE });
    expect(screen.getAllByText("up to 500/mo").length).toBeGreaterThan(0);
    expect(screen.getByText("up to 50000/mo")).toBeDefined();
    expect(screen.queryByText(/unlimited/i)).toBeNull();
    expect(screen.queryByText(/ilimitad/i)).toBeNull();
  });

  it("shows the empty-usage message when no usage is recorded", () => {
    renderClient({ initialData: TRIALING });
    expect(screen.getByText(/No usage recorded yet/i)).toBeDefined();
  });
});

describe("BillingPageClient — invoice history (owner-only)", () => {
  it("renders invoices with a receipt link for an owner", () => {
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: OWNER_INVOICES });
    expect(screen.getByText(/Invoices & charges/i)).toBeDefined();
    const receipt = screen.getByRole("link", { name: /receipt/i });
    expect(receipt.getAttribute("href")).toBe("https://stripe.test/r/1");
  });

  it("shows the empty state when the owner has no invoices", () => {
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: OWNER_NO_INVOICES });
    expect(screen.getByText(/No charges yet/i)).toBeDefined();
  });

  // #197: an INITIAL transient invoice error is NOT a definitive ownership
  // signal, so the owner-only invoice section is hidden (fail-closed) rather
  // than shown — previously an `error` was treated as "owner".
  it("hides the owner-only invoice history on an initial transient error (ownership unknown, #197)", () => {
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: INVOICE_ERROR });
    expect(screen.queryByText(/Invoices & charges/i)).toBeNull();
  });

  it("hides the invoice history entirely for a non-owner", () => {
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: NON_OWNER });
    expect(screen.queryByText(/Invoices & charges/i)).toBeNull();
  });
});

describe("BillingPageClient — ownership on transient invoice error (#197)", () => {
  it("does NOT grant owner-only controls when the invoice read is a transient error (no owner flip)", () => {
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: INVOICE_ERROR });
    // A transient error must never promote a caller into the owner UI.
    expect(screen.queryByRole("button", { name: /manage \/ add card/i })).toBeNull();
    expect(screen.queryByText(/Invoices & charges/i)).toBeNull();
  });

  it("preserves an established owner's UI when a later refresh hits a transient invoice error (graceful degrade)", async () => {
    getBillingVisibilityAction.mockResolvedValue({ kind: "ok", data: PRO_ACTIVE });
    getBillingInvoicesAction.mockResolvedValue(INVOICE_ERROR);
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: OWNER_INVOICES });

    // Ownership is established (definitive ok) — owner controls render.
    expect(screen.getByRole("button", { name: /manage \/ add card/i })).toBeDefined();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    // After the transient error: the owner is NOT flipped to non-owner. The
    // invoice section degrades to its error card, and the owner-only payment
    // control is preserved.
    await waitFor(() => expect(screen.getByText(/couldn't load your invoices/i)).toBeDefined());
    expect(screen.getByRole("button", { name: /manage \/ add card/i })).toBeDefined();
  });
});

describe("BillingPageClient — Pro card cycle toggle + save badge", () => {
  it("shows the monthly price and derived save badge by default", () => {
    renderClient({ initialData: FREE_ACTIVE });
    expect(screen.getByText(/9\.99/)).toBeDefined();
    expect(screen.getByText(/Save 20%/i)).toBeDefined();
  });

  it("updates the displayed price when toggling to Annual", async () => {
    renderClient({ initialData: FREE_ACTIVE });
    const annual = screen.getByRole("radio", { name: /annual/i });
    await act(async () => {
      annual.click();
    });
    expect(screen.getByText(/7\.99/)).toBeDefined();
    expect(screen.getByText(/billed annually/i)).toBeDefined();
  });

  it("does not render the Pro card price when pricing is unavailable", () => {
    renderClient({ initialData: FREE_ACTIVE, pricing: null });
    expect(screen.queryByText(/Save 20%/i)).toBeNull();
  });
});

describe("BillingPageClient — payment + support cards", () => {
  it("renders the support card for everyone", () => {
    renderClient({ initialData: FREE_ACTIVE, initialInvoices: NON_OWNER });
    expect(screen.getByText(/Need help\?/i)).toBeDefined();
    expect(screen.getByRole("link", { name: /billing FAQ/i })).toBeDefined();
  });

  it("links the support card to the real /help/billing route, not a dead placeholder (#199)", () => {
    renderClient({ initialData: FREE_ACTIVE, initialInvoices: NON_OWNER });
    const link = screen.getByRole("link", { name: /billing FAQ/i });
    // A real, navigable anchor — never an aria-disabled placeholder span.
    expect(link.getAttribute("href")).toBe("/help/billing");
    expect(link.getAttribute("aria-disabled")).toBeNull();
  });

  it("shows the payment-method manage CTA only for an owner", () => {
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: OWNER_INVOICES });
    expect(screen.getByRole("button", { name: /manage \/ add card/i })).toBeDefined();
  });

  it("hides the payment-method manage CTA for a non-owner", () => {
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: NON_OWNER });
    expect(screen.queryByRole("button", { name: /manage \/ add card/i })).toBeNull();
  });
});

describe("BillingPageClient — checkout + portal CTAs", () => {
  it("starts checkout for the selected cycle and redirects to the Stripe url", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "ok", url: "https://checkout.stripe.test/go" });
    renderClient({ initialData: FREE_ACTIVE });

    const annual = screen.getByRole("radio", { name: /annual/i });
    await act(async () => {
      annual.click();
    });
    const cta = screen.getByRole("button", { name: /upgrade to pro/i });
    await act(async () => {
      cta.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(startCheckoutAction).toHaveBeenCalledWith("annual", undefined));
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.test/go"));
  });

  it("surfaces a checkout error without redirecting", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "error", message: "server_error" });
    renderClient({ initialData: FREE_ACTIVE });

    const cta = screen.getByRole("button", { name: /upgrade to pro/i });
    await act(async () => {
      cta.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/couldn't start checkout/i)).toBeDefined());
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("surfaces the controlled invalid-promotion error", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "error", message: "invalid_promotion_code" });
    renderClient({ initialData: FREE_ACTIVE });

    const cta = screen.getByRole("button", { name: /upgrade to pro/i });
    await act(async () => {
      cta.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/promotion code isn't valid/i)).toBeDefined());
  });

  it("opens the portal and redirects for an owner", async () => {
    openPortalAction.mockResolvedValue({ kind: "ok", url: "https://billing.stripe.test/portal" });
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: OWNER_INVOICES });

    const manage = screen.getByRole("button", { name: /manage \/ add card/i });
    await act(async () => {
      manage.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(openPortalAction).toHaveBeenCalled());
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith("https://billing.stripe.test/portal"));
  });

  it("surfaces a portal error without redirecting", async () => {
    openPortalAction.mockResolvedValue({ kind: "error", message: "server_error" });
    renderClient({ initialData: PRO_ACTIVE, initialInvoices: OWNER_INVOICES });

    const manage = screen.getByRole("button", { name: /manage \/ add card/i });
    await act(async () => {
      manage.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText(/couldn't open the billing portal/i)).toBeDefined());
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("BillingPageClient — states", () => {
  it("renders an accessible error state with a focused retry button when online", () => {
    vi.stubGlobal("navigator", { onLine: true });
    renderClient({ initialData: null, initialError: "server_error" });
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeDefined();
    expect(document.activeElement).toBe(retry);
  });

  it("renders an offline state when the load failed while offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    renderClient({ initialData: null, initialError: "api_unreachable" });
    expect(screen.getByText(/offline/i)).toBeDefined();
  });

  it("shows the bootstrap empty state when there is no data and no error", () => {
    renderClient({ initialData: null });
    expect(screen.getByText("No billing data yet.")).toBeDefined();
  });

  it("refreshes billing + invoices from the new tenant on tab focus (tenant switch)", async () => {
    getBillingVisibilityAction.mockResolvedValue({ kind: "ok", data: PRO_ACTIVE });
    getBillingInvoicesAction.mockResolvedValue(NON_OWNER);
    renderClient({ initialData: FREE_ACTIVE, initialInvoices: OWNER_INVOICES });

    expect(screen.getByRole("link", { name: /receipt/i })).toBeDefined();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    // New tenant is non-owner → invoice section (and its receipt link) is gone.
    await waitFor(() => expect(screen.queryByRole("link", { name: /receipt/i })).toBeNull());
    expect(getBillingInvoicesAction).toHaveBeenCalled();
  });

  it("re-shows the error state when a retry itself fails", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    getBillingVisibilityAction.mockResolvedValue({ kind: "error", message: "server_error" });
    getBillingInvoicesAction.mockResolvedValue(INVOICE_ERROR);
    renderClient({ initialData: null, initialError: "server_error" });

    const retry = screen.getByRole("button", { name: /retry/i });
    await act(async () => {
      retry.click();
      await Promise.resolve();
    });

    await waitFor(() => expect(getBillingVisibilityAction).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("shows an accessible loading indicator while a retry is in flight", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    let resolveRetry: (v: { kind: "ok"; data: BillingVisibilityDTO }) => void = () => {};
    getBillingVisibilityAction.mockReturnValue(
      new Promise((resolve) => {
        resolveRetry = resolve;
      }),
    );
    getBillingInvoicesAction.mockResolvedValue(OWNER_NO_INVOICES);
    renderClient({ initialData: null, initialError: "server_error" });

    const retry = screen.getByRole("button", { name: /retry/i });
    act(() => {
      retry.click();
    });

    expect(screen.getByRole("progressbar")).toBeDefined();

    await act(async () => {
      resolveRetry({ kind: "ok", data: PRO_ACTIVE });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText("Current plan")).toBeDefined());
  });

  it("flips between error and offline live as connectivity changes", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    renderClient({ initialData: null, initialError: "api_unreachable" });

    // Online + api_unreachable → error card, not offline.
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    expect(screen.queryByText(/offline/i)).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/offline/i)).toBeDefined();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText(/offline/i)).toBeNull();
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("refreshes on visibilitychange when the tab becomes visible", async () => {
    getBillingVisibilityAction.mockResolvedValue({ kind: "ok", data: PRO_ACTIVE });
    getBillingInvoicesAction.mockResolvedValue(OWNER_NO_INVOICES);
    renderClient({ initialData: FREE_ACTIVE, initialInvoices: OWNER_NO_INVOICES });

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    await waitFor(() => expect(getBillingVisibilityAction).toHaveBeenCalled());
  });
});
