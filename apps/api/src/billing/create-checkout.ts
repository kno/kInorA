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
  /**
   * Optional per-cycle "Trainer Seat" Price ids (16c v3 Slice E). Undefined
   * when the seat product is not yet configured — the Pro checkout path never
   * reads these fields, so an unconfigured seat price cannot affect it.
   */
  trainerSeatMonthly?: string;
  trainerSeatAnnual?: string;
}

/** Which Stripe product a checkout session opens (16c v3 Slice E). Defaults to `"pro"`. */
export type CheckoutProduct = "pro" | "trainer";

export interface CreateCheckoutInput {
  /** Resolved SERVER-SIDE from `authContext`; NEVER from the request body. */
  tenantId: string;
  cycle: BillingCycle;
  /** Optional promotion code, validated server-side before any session opens. */
  promotionCode?: string;
  /**
   * Which Stripe product to check out. Defaults to `"pro"` — preserves the
   * existing behavior for every caller that does not pass this field.
   */
  product?: CheckoutProduct;
  /**
   * Only meaningful for `product: "trainer"`. Floored to `max(1, initialSeatCount ?? 0)`
   * before being sent as the line-item quantity (a licensed recurring price
   * cannot be `quantity: 0` — a brand-new trainer with zero clients still
   * checks out with quantity 1).
   */
  initialSeatCount?: number;
}

/**
 * Thrown when `product: "trainer"` is requested but the seat Price id for the
 * requested cycle is not configured. This is a controlled, explicit failure —
 * NEVER a silent fallback to the Pro price (that would bill the wrong product).
 */
export class TrainerSeatPriceNotConfiguredError extends Error {
  constructor(message = "trainer seat price is not configured for this billing cycle") {
    super(message);
    this.name = "TrainerSeatPriceNotConfiguredError";
  }
}

export class CreateCheckout {
  constructor(
    private readonly gateway: CheckoutGateway,
    private readonly pricing: CheckoutPriceConfig,
  ) {}

  async execute(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const product = input.product ?? "pro";

    let priceId: string;
    let quantity: number | undefined;
    if (product === "trainer") {
      const seatPriceId =
        input.cycle === "annual" ? this.pricing.trainerSeatAnnual : this.pricing.trainerSeatMonthly;
      if (!seatPriceId) {
        throw new TrainerSeatPriceNotConfiguredError();
      }
      priceId = seatPriceId;
      // Zero-seat rule (Q3/Q5): floor to at least 1 — a licensed recurring
      // price line item cannot be quantity 0.
      quantity = Math.max(1, input.initialSeatCount ?? 0);
    } else {
      priceId = input.cycle === "annual" ? this.pricing.priceAnnual : this.pricing.priceMonthly;
    }

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
      // Omitted (undefined) on the Pro path — the gateway defaults to
      // quantity 1, byte-identical to the pre-Slice-E behavior.
      ...(quantity !== undefined ? { quantity } : {}),
    });
  }
}
