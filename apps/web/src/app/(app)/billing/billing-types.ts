/**
 * Client-safe billing result types (11b Slice 5).
 *
 * These discriminated-result shapes are shared between the server-only
 * `billing-client.ts` fetchers, the server actions, and the client component.
 * They live in this NON `server-only` module so the client component can import
 * the types without pulling in the server-only fetch module (enforced by the
 * repo's UI→API guard + Next.js `server-only`). No runtime code, types only.
 */
import type { BillingPricingDTO, BillingVisibilityDTO, InvoiceDTO } from "@kinora/contracts";

export type GetBillingVisibilityResult =
  | { kind: "ok"; data: BillingVisibilityDTO }
  | { kind: "error"; message: string };

export type GetBillingPricingResult =
  | { kind: "ok"; data: BillingPricingDTO }
  | { kind: "error"; message: string };

/**
 * Result of the owner-only invoice read. `forbidden` (from a 403) is a
 * first-class, NON-error outcome: the caller is not an owner, so the UI hides
 * the owner-only invoice history + portal CTA gracefully rather than rendering
 * a broken/erroring action. `error` is reserved for transient failures (5xx,
 * network, malformed payload) where ownership is unknown.
 */
export type GetBillingInvoicesResult =
  | { kind: "ok"; invoices: InvoiceDTO[] }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** Result of starting a Stripe-hosted checkout. `message` may be `invalid_promotion_code`. */
export type StartCheckoutResult =
  | { kind: "ok"; url: string }
  | { kind: "error"; message: string };

/** Result of opening the Stripe Customer Portal (owner-only → `forbidden` on 403). */
export type OpenPortalResult =
  | { kind: "ok"; url: string }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };
