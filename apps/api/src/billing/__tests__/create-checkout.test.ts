import { describe, expect, it, vi } from "vitest";
import { CreateCheckout } from "../create-checkout.js";
import {
  InvalidPromotionCodeError,
  type CheckoutGateway,
  type CreateCheckoutSessionInput,
  type PromotionCodeValidation,
} from "../stripe-gateway.js";

// ---------------------------------------------------------------------------
// Slice 3 — Stripe checkout use case (payments hot path).
//
// The pure CreateCheckout use case selects the config-driven Price for the
// requested cycle, forwards the tenant (which becomes the Stripe
// client_reference_id / subscription metadata server-side) UNCHANGED, and
// returns the Stripe-hosted session URL. It NEVER imports the `stripe` SDK —
// it depends only on the CheckoutGateway port, exercised here via a fake.
//
// Invariants proven:
//   - monthly request → the configured MONTHLY price id is used
//   - annual request  → the configured ANNUAL price id is used
//   - the tenant id is passed straight through to the gateway (the route is the
//     only place authContext resolves it; the use case can only ever use what
//     it is handed, so a client-supplied tenant can never reach the gateway)
//   - no promotion code → validatePromotionCode is NEVER called and the session
//     is created with no discount
//   - the Stripe-hosted URL is returned verbatim
// ---------------------------------------------------------------------------

const PRICING = { priceMonthly: "price_monthly_cfg", priceAnnual: "price_annual_cfg" };
const TENANT = "11111111-0000-0000-0000-000000000001";

function fakeGateway(overrides: Partial<CheckoutGateway> = {}): {
  gateway: CheckoutGateway;
  createSpy: ReturnType<typeof vi.fn>;
  validateSpy: ReturnType<typeof vi.fn>;
} {
  const createSpy = vi.fn(
    async (input: CreateCheckoutSessionInput) => ({ url: `https://checkout.stripe.test/session?price=${input.priceId}` }),
  );
  const validateSpy = vi.fn(
    async (): Promise<PromotionCodeValidation> => ({ valid: true, promotionCodeId: "promo_default" }),
  );
  const gateway: CheckoutGateway = {
    createCheckoutSession: createSpy as CheckoutGateway["createCheckoutSession"],
    validatePromotionCode: validateSpy as CheckoutGateway["validatePromotionCode"],
    ...overrides,
  };
  return { gateway, createSpy, validateSpy };
}

describe("CreateCheckout (11b Slice 3)", () => {
  it("selects the MONTHLY config price for a monthly checkout", async () => {
    const { gateway, createSpy } = fakeGateway();
    const uc = new CreateCheckout(gateway, PRICING);

    const result = await uc.execute({ tenantId: TENANT, cycle: "monthly" });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, cycle: "monthly", priceId: "price_monthly_cfg" }),
    );
    expect(result).toEqual({ url: "https://checkout.stripe.test/session?price=price_monthly_cfg" });
  });

  it("selects the ANNUAL config price for an annual checkout", async () => {
    const { gateway, createSpy } = fakeGateway();
    const uc = new CreateCheckout(gateway, PRICING);

    const result = await uc.execute({ tenantId: TENANT, cycle: "annual" });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cycle: "annual", priceId: "price_annual_cfg" }),
    );
    expect(result.url).toContain("price_annual_cfg");
  });

  it("forwards the exact tenant id it is given as the checkout owner (client_reference_id source)", async () => {
    const { gateway, createSpy } = fakeGateway();
    const uc = new CreateCheckout(gateway, PRICING);

    await uc.execute({ tenantId: TENANT, cycle: "monthly" });

    const passed = createSpy.mock.calls[0]![0] as CreateCheckoutSessionInput;
    expect(passed.tenantId).toBe(TENANT);
  });

  it("does NOT validate a promotion code when none is supplied and creates a discount-free session", async () => {
    const { gateway, createSpy, validateSpy } = fakeGateway();
    const uc = new CreateCheckout(gateway, PRICING);

    await uc.execute({ tenantId: TENANT, cycle: "monthly" });

    expect(validateSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ promotionCodeId: null }),
    );
  });

  it("treats a blank/whitespace promotion code as absent (no validation, no discount)", async () => {
    const { gateway, validateSpy, createSpy } = fakeGateway();
    const uc = new CreateCheckout(gateway, PRICING);

    await uc.execute({ tenantId: TENANT, cycle: "monthly", promotionCode: "   " });

    expect(validateSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ promotionCodeId: null }));
  });

  it("re-exports InvalidPromotionCodeError as an Error subclass for the route to map", () => {
    expect(new InvalidPromotionCodeError()).toBeInstanceOf(Error);
  });
});
