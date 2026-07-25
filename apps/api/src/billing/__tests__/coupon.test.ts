import { describe, expect, it, vi } from "vitest";
import { CreateCheckout } from "../create-checkout.js";
import {
  InvalidPromotionCodeError,
  type CheckoutGateway,
  type CreateCheckoutSessionInput,
  type PromotionCodeValidation,
} from "../stripe-gateway.js";

// ---------------------------------------------------------------------------
// Slice 3 — Server-side coupon / promotion-code validation (payments hot path).
//
// A coupon is validated SERVER-SIDE, through the gateway, BEFORE any checkout
// session is created, so an invalid or expired code is rejected with OUR OWN
// controlled error (InvalidPromotionCodeError) and NO Stripe session is ever
// opened. A valid code is attached to the session via its resolved Stripe
// promotion_code id. Nothing about the code is trusted from the client beyond
// the raw string handed to Stripe for validation.
// ---------------------------------------------------------------------------

const PRICING = { priceMonthly: "price_m", priceAnnual: "price_a" };
const TENANT = "22222222-0000-0000-0000-000000000002";

function gatewayWith(validation: PromotionCodeValidation | Error) {
  const createSpy = vi.fn(async (_input: CreateCheckoutSessionInput) => ({ url: "https://checkout.stripe.test/ok" }));
  const validateSpy = vi.fn(async (): Promise<PromotionCodeValidation> => {
    if (validation instanceof Error) throw validation;
    return validation;
  });
  const gateway: CheckoutGateway = {
    createCheckoutSession: createSpy as CheckoutGateway["createCheckoutSession"],
    validatePromotionCode: validateSpy as CheckoutGateway["validatePromotionCode"],
  };
  return { gateway, createSpy, validateSpy };
}

describe("CreateCheckout coupon validation (11b Slice 3)", () => {
  it("attaches a VALID promotion code to the session by its resolved Stripe id", async () => {
    const { gateway, createSpy, validateSpy } = gatewayWith({ valid: true, promotionCodeId: "promo_live_1" });
    const uc = new CreateCheckout(gateway, PRICING);

    await uc.execute({ tenantId: TENANT, cycle: "monthly", promotionCode: "SUMMER25" });

    expect(validateSpy).toHaveBeenCalledWith("SUMMER25");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ promotionCodeId: "promo_live_1" }),
    );
  });

  it("rejects an INVALID code server-side with a controlled error and creates NO session", async () => {
    const { gateway, createSpy, validateSpy } = gatewayWith({ valid: false, promotionCodeId: null });
    const uc = new CreateCheckout(gateway, PRICING);

    await expect(
      uc.execute({ tenantId: TENANT, cycle: "monthly", promotionCode: "BOGUS" }),
    ).rejects.toBeInstanceOf(InvalidPromotionCodeError);

    expect(validateSpy).toHaveBeenCalledWith("BOGUS");
    // No checkout session may be opened for an invalid coupon (fail-closed).
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects an EXPIRED code (valid=false) the same way — controlled error, no session", async () => {
    const { gateway, createSpy } = gatewayWith({ valid: false, promotionCodeId: null });
    const uc = new CreateCheckout(gateway, PRICING);

    await expect(
      uc.execute({ tenantId: TENANT, cycle: "annual", promotionCode: "EXPIRED2024" }),
    ).rejects.toBeInstanceOf(InvalidPromotionCodeError);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("treats a validation that reports valid but yields no id as invalid (no session)", async () => {
    const { gateway, createSpy } = gatewayWith({ valid: true, promotionCodeId: null });
    const uc = new CreateCheckout(gateway, PRICING);

    await expect(
      uc.execute({ tenantId: TENANT, cycle: "monthly", promotionCode: "WEIRD" }),
    ).rejects.toBeInstanceOf(InvalidPromotionCodeError);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
