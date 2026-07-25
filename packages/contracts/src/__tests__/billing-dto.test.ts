import { describe, expect, expectTypeOf, it } from "vitest";
import * as contracts from "../index";
import type {
  BillingCycle,
  BillingSource,
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  InvoiceDTO,
  PortalSessionResponse,
  TenantBillingStateDTO,
} from "../index";

describe("stripe billing DTO contracts (11b Slice 1)", () => {
  it("extends BillingSource with 'stripe' while keeping the 11a values", () => {
    expectTypeOf<BillingSource>().toEqualTypeOf<
      "system" | "backfill" | "admin_override" | "stripe"
    >();
    const stripe: BillingSource = "stripe";
    const admin: BillingSource = "admin_override";
    expect(stripe).toBe("stripe");
    expect(admin).toBe("admin_override");
  });

  it("defines BillingCycle as exactly monthly | annual", () => {
    expectTypeOf<BillingCycle>().toEqualTypeOf<"monthly" | "annual">();
    const cycles: BillingCycle[] = ["monthly", "annual"];
    expect(cycles).toEqual(["monthly", "annual"]);
  });

  it("carries the additive stripe subscription/period fields on TenantBillingStateDTO", () => {
    // Optional in Slice 1 so the 11a visibility mapper compiles unchanged
    // (zero behavior change); later slices populate them.
    expectTypeOf<TenantBillingStateDTO>()
      .toHaveProperty("billingCycle")
      .toEqualTypeOf<BillingCycle | null | undefined>();
    expectTypeOf<TenantBillingStateDTO>()
      .toHaveProperty("currentPeriodEnd")
      .toEqualTypeOf<string | null | undefined>();
    expectTypeOf<TenantBillingStateDTO>()
      .toHaveProperty("cancelAtPeriodEnd")
      .toEqualTypeOf<boolean | undefined>();
    // A concrete Stripe-driven Pro state must satisfy the DTO.
    const proViaStripe: TenantBillingStateDTO = {
      tenantId: "t-1" as TenantBillingStateDTO["tenantId"],
      tier: "pro",
      status: "active",
      source: "stripe",
      trialStartedAt: null,
      trialEndsAt: null,
      activeOverrideEndsAt: null,
      updatedAt: "2026-07-25T00:00:00.000Z",
      billingCycle: "annual",
      currentPeriodEnd: "2027-07-25T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    };
    expect(proViaStripe.source).toBe("stripe");
    expect(proViaStripe.billingCycle).toBe("annual");
    expect(proViaStripe.cancelAtPeriodEnd).toBe(false);
  });

  it("scaffolds the checkout/portal request+response DTOs for later slices", () => {
    expectTypeOf<CheckoutSessionRequest>().toEqualTypeOf<{
      cycle: BillingCycle;
      promotionCode?: string;
    }>();
    expectTypeOf<CheckoutSessionResponse>().toEqualTypeOf<{ url: string }>();
    expectTypeOf<PortalSessionResponse>().toEqualTypeOf<{ url: string }>();

    const req: CheckoutSessionRequest = { cycle: "monthly", promotionCode: "LAUNCH20" };
    const res: CheckoutSessionResponse = { url: "https://checkout.stripe.test/s/1" };
    expect(req.cycle).toBe("monthly");
    expect(res.url).toContain("stripe");
  });

  it("scaffolds a privacy-safe InvoiceDTO with no PAN, only brand + last4", () => {
    const invoice: InvoiceDTO = {
      id: "in_1",
      amountDue: 999,
      currency: "eur",
      status: "paid",
      createdAt: "2026-07-25T00:00:00.000Z",
      hostedInvoiceUrl: "https://invoice.stripe.test/i/1",
      receiptUrl: null,
      cardBrand: "visa",
      cardLast4: "4242",
    };
    expect(invoice.cardLast4).toBe("4242");
    // The only card fields allowed are brand + last4 — no full PAN key exists.
    expect(Object.keys(invoice)).not.toContain("cardNumber");
    expect(Object.keys(invoice)).not.toContain("pan");
    // Empty-invoice safe: receipt/hosted urls are nullable.
    const minimal: InvoiceDTO = {
      id: "in_2",
      amountDue: 0,
      currency: "eur",
      status: "open",
      createdAt: "2026-07-25T00:00:00.000Z",
      hostedInvoiceUrl: null,
      receiptUrl: null,
    };
    expect(minimal.cardBrand).toBeUndefined();
  });

  it("does NOT add any new runtime export to the contracts surface (type-only slice)", () => {
    // The 11b billing Slice 1 additions are all type-only; this asserts they added
    // no runtime export. PlanSpecDraftSchema (12-interactive-text-chat) is the only
    // runtime export added after this slice and stays in sync with contracts.test.ts.
    expect(Object.keys(contracts)).toEqual([
      "WorkoutProgramSchema",
      "DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG",
      "BILLING_FEATURES",
      "MUSCLE_GROUPS",
      "PlanSpecDraftSchema",
    ]);
  });
});
