import type { BillingCycle } from "@kinora/contracts";
import {
  InvalidPromotionCodeError,
  type CheckoutGateway,
  type CheckoutSession,
} from "./stripe-gateway.js";

// Re-export so callers (the route) can map the controlled coupon error without
// reaching into the port module directly.
export { InvalidPromotionCodeError } from "./stripe-gateway.js";

/**
 * Pure checkout use case (11b-v1-billing-stripe-integration, Slice 3).
 *
 * SDK-free: depends only on the {@link CheckoutGateway} port and the two
 * config-driven Price ids (resolved from `pricing-config.ts` env at the
 * composition root). It selects the Price for the requested cycle, validates
 * any promotion code SERVER-SIDE before opening a session, and returns the
 * Stripe-hosted URL. The tenant is passed straight through — the ROUTE is the
 * only place it is resolved (from `authContext`), so a client-supplied tenant
 * can never reach the gateway through this use case.
 */

/** The config-driven Stripe Price ids, one per billing cycle. */
export interface CheckoutPriceConfig {
  priceMonthly: string;
  priceAnnual: string;
}

export interface CreateCheckoutInput {
  /** Resolved SERVER-SIDE from `authContext`; NEVER from the request body. */
  tenantId: string;
  cycle: BillingCycle;
  /** Optional promotion code, validated server-side before any session opens. */
  promotionCode?: string;
}

export class CreateCheckout {
  constructor(
    private readonly gateway: CheckoutGateway,
    private readonly pricing: CheckoutPriceConfig,
  ) {}

  async execute(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const priceId = input.cycle === "annual" ? this.pricing.priceAnnual : this.pricing.priceMonthly;

    // Validate a promotion code SERVER-SIDE first. An invalid/expired code is
    // rejected with our controlled error and NO checkout session is created.
    let promotionCodeId: string | null = null;
    const code = input.promotionCode?.trim();
    if (code) {
      const validation = await this.gateway.validatePromotionCode(code);
      if (!validation.valid || !validation.promotionCodeId) {
        throw new InvalidPromotionCodeError();
      }
      promotionCodeId = validation.promotionCodeId;
    }

    return this.gateway.createCheckoutSession({
      tenantId: input.tenantId,
      cycle: input.cycle,
      priceId,
      promotionCodeId,
    });
  }
}
