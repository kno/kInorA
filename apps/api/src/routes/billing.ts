import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type {
  BillingFeature,
  CheckoutSessionRequest,
  CheckoutSessionResponse,
  BillingVisibilityDTO,
  InvoiceDTO,
  PortalSessionResponse,
  SetMemberAllocationRequest,
  SetMemberAllocationResponse,
  TenantUsageReportDTO,
  UserId,
} from "@kinora/contracts";
import { BILLING_FEATURES } from "@kinora/contracts";
import type { BillingPricingDTO } from "@kinora/contracts";
import { requireAuth } from "../auth/plugin.js";
import { PERIOD_PATTERN, currentBillingPeriod } from "../billing/plan-limits.js";
import { buildBillingPricing } from "../billing/pricing-config.js";
import type {
  AdminMembershipView,
  GetTenantUsageInput,
  GetTenantUsageOutcome,
  SetMemberAllocationInput,
  SetMemberAllocationOutcome,
} from "../billing/quota-admin.js";
import { isActiveOwner } from "../billing/quota-admin.js";
import type { GetBillingVisibilityOutcome } from "../billing/billing-visibility.js";
import type { ProcessWebhookResult } from "../billing/process-webhook.js";
import type { CreateCheckoutInput } from "../billing/create-checkout.js";
import { InvalidPromotionCodeError } from "../billing/create-checkout.js";
import type { CreatePortalSessionInput } from "../billing/create-portal-session.js";
import { NoStripeCustomerError } from "../billing/create-portal-session.js";
import type { ListInvoicesInput } from "../billing/list-invoices.js";
import type { CheckoutSession, PortalSession } from "../billing/stripe-gateway.js";

/**
 * Billing routes (11a, Phase 3 + Phase 4).
 *
 * All routes require an authenticated, ACTIVE membership (the auth plugin
 * re-checks membership status per request, so a suspended actor is rejected
 * with 401 before any handler runs). Tenant + actor identity are ALWAYS read
 * from `request.authContext` — never from the body/params — so a caller can only
 * ever administer/view their own active tenant (cross-tenant access is impossible).
 *
 * Privacy boundary: these endpoints expose ONLY aggregate/member usage COUNTS,
 * allocation limits, and billing-state metadata. They never read or return
 * member memories, prompts, health details, or generated private content.
 *
 * Routes:
 *   GET /billing/usage         → owner-only tenant + per-member usage counts
 *   PUT /billing/allocations   → owner-only set a member allocation (audited)
 *   GET /billing/visibility    → ANY active member: tenant billing state +
 *                                 tenant usage + the requester's OWN usage
 *                                 (spec `Billing State Visibility`, Phase 4)
 *   POST /billing/portal       → owner-only Stripe Customer Portal session
 *                                 (11b Slice 4 4R FIX 1 — see below)
 *   GET /billing/invoices      → owner-only invoice history
 *                                 (11b Slice 4 4R FIX 1 — see below)
 *
 * Portal + invoices are OWNER-ONLY (11b-v1 Slice 4, 4R FIX 1), broader than the
 * plain "any active member" gate on GET /billing/visibility: the Customer
 * Portal lets the caller change the payment method AND CANCEL THE TENANT'S
 * SUBSCRIPTION, and invoices expose long-lived `hostedInvoiceUrl`/`receiptUrl`
 * links whose PDFs carry the tenant's billing name/address (owner PII). Both
 * are gated with the SAME `isActiveOwner` check the quota-admin use cases use
 * (apps/api/src/billing/quota-admin.ts), resolved via `checkBillingOwnership`.
 */
export interface BillingRoutesOptions {
  setMemberAllocation: {
    execute(input: SetMemberAllocationInput): Promise<SetMemberAllocationOutcome>;
  };
  getTenantUsage: {
    execute(input: GetTenantUsageInput): Promise<GetTenantUsageOutcome>;
  };
  getBillingVisibility: {
    execute(
      scope: { tenantId: string; userId: string },
      period: string,
    ): Promise<GetBillingVisibilityOutcome>;
  };
  createCheckout: {
    execute(input: CreateCheckoutInput): Promise<CheckoutSession>;
  };
  createPortalSession: {
    execute(input: CreatePortalSessionInput): Promise<PortalSession>;
  };
  listInvoices: {
    execute(input: ListInvoicesInput): Promise<InvoiceDTO[]>;
  };
  /**
   * Owner-only authorization port for the Customer Portal + invoice endpoints
   * (11b Slice 4 4R FIX 1). Reuses the EXACT SAME shape as
   * `QuotaAdminPort.loadActorMembership` (see `billing/quota-admin.ts`) so the
   * composition root can wire the SAME `BillingAdminRepository` instance
   * already used for `setMemberAllocation`/`getTenantUsage` — one owner check,
   * one repository, no duplicated authorization logic.
   */
  checkBillingOwnership: {
    loadActorMembership(scope: {
      tenantId: string;
      userId: string;
    }): Promise<AdminMembershipView | null>;
  };
}

/**
 * Map a use-case denial reason to an HTTP status. Fail-closed: an authorization
 * failure is 403; an out-of-bounds allocation is a 422 validation error; a
 * missing billing state is 403 (deny rather than expose an unresolved state).
 */
function denialStatus(reason: string): number {
  if (reason === "allocation_out_of_bounds") return 422;
  return 403;
}

/**
 * #175 — make a DENIED quota-admin attempt observable. Only SUCCESSFUL
 * mutations write a `billing_audit_events` row (see BillingAdminRepository);
 * denials are emitted as a STRUCTURED SERVER LOG via the per-request logger
 * instead of a new audit DB row. Rationale: writing a row per denied probe is
 * DoS-able — an attacker could spam denials to bloat the audit table — whereas
 * a log line is bounded by log retention and never grows unbounded product
 * state. The payload carries the actor, the attempted subject, and the reason
 * (ids + enum only) so it is diagnosable without exposing any secret, session
 * token, or private member content.
 */
function logDeniedQuotaAdmin(
  request: FastifyRequest,
  context: {
    route: string;
    tenantId: string;
    actorUserId: string;
    reason: string;
    subjectUserId?: string;
    feature?: string;
    period?: string;
  },
): void {
  request.log.warn(
    { event: "billing.quota_admin.denied", ...context },
    "denied quota-admin attempt",
  );
}

export const billingRoutes: FastifyPluginAsync<BillingRoutesOptions> = async (
  fastify,
  options,
) => {
  const {
    setMemberAllocation,
    getTenantUsage,
    getBillingVisibility,
    createCheckout,
    createPortalSession,
    listInvoices,
    checkBillingOwnership,
  } = options;

  if (
    !setMemberAllocation ||
    !getTenantUsage ||
    !getBillingVisibility ||
    !createCheckout ||
    !createPortalSession ||
    !listInvoices ||
    !checkBillingOwnership
  ) {
    throw new Error(
      "billingRoutes requires setMemberAllocation, getTenantUsage, getBillingVisibility, createCheckout, createPortalSession, listInvoices, and checkBillingOwnership",
    );
  }

  /**
   * Owner-only guard for the Customer Portal + invoice endpoints (11b Slice 4
   * 4R FIX 1). Resolves the actor's membership via `checkBillingOwnership`
   * (the SAME `QuotaAdminPort.loadActorMembership` shape) and denies a
   * non-owner with the SAME `unauthorized_quota_admin` reason/403 the
   * quota-admin endpoints use — fail-closed: a missing membership, non-owner
   * role, or non-active status is never authorized. Logs the denial via the
   * same `logDeniedQuotaAdmin` structured-log convention as #175.
   */
  async function requireBillingOwner(
    request: FastifyRequest,
    reply: FastifyReply,
    route: string,
  ): Promise<{ tenantId: string; userId: string } | null> {
    const { tenantId, userId } = request.authContext!;
    const actor = await checkBillingOwnership.loadActorMembership({ tenantId, userId });
    if (!isActiveOwner(actor)) {
      logDeniedQuotaAdmin(request, {
        route,
        tenantId,
        actorUserId: userId,
        reason: "unauthorized_quota_admin",
      });
      reply.code(403).send({ error: "unauthorized_quota_admin" });
      return null;
    }
    return { tenantId, userId };
  }

  // GET /billing/usage?period=YYYY-MM
  // Owner-only aggregate tenant + per-member usage counts. Period defaults to the
  // current calendar-month billing period when the query param is absent/invalid.
  fastify.get(
    "/billing/usage",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const query = request.query as { period?: string } | undefined;
      const period =
        query?.period && PERIOD_PATTERN.test(query.period)
          ? query.period
          : currentBillingPeriod(new Date());

      const result = await getTenantUsage.execute({
        tenantId,
        actorUserId: userId,
        period,
      });

      if (!result.ok) {
        logDeniedQuotaAdmin(request, {
          route: "GET /billing/usage",
          tenantId,
          actorUserId: userId,
          period,
          reason: result.reason,
        });
        return reply.code(denialStatus(result.reason)).send({ error: result.reason });
      }

      return reply.code(200).send({
        tenantUsage: result.tenantUsage,
        memberUsage: result.memberUsage,
      } satisfies TenantUsageReportDTO);
    },
  );

  // PUT /billing/allocations
  // Owner-only. Body: SetMemberAllocationRequest { userId, feature, period, limit }.
  // The tenant is taken from authContext; any body tenantId is ignored.
  fastify.put(
    "/billing/allocations",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const body = request.body as Partial<SetMemberAllocationRequest> | null;

      if (
        body === null ||
        typeof body !== "object" ||
        typeof body.userId !== "string" ||
        body.userId.trim() === "" ||
        typeof body.feature !== "string" ||
        !(BILLING_FEATURES as readonly string[]).includes(body.feature) ||
        typeof body.period !== "string" ||
        !PERIOD_PATTERN.test(body.period) ||
        typeof body.limit !== "number" ||
        !Number.isInteger(body.limit) ||
        body.limit < 0
      ) {
        return reply.code(422).send({ error: "invalid_allocation_request" });
      }

      const result = await setMemberAllocation.execute({
        tenantId,
        actorUserId: userId,
        subjectUserId: body.userId,
        feature: body.feature as BillingFeature,
        period: body.period,
        limit: body.limit,
      });

      if (!result.ok) {
        logDeniedQuotaAdmin(request, {
          route: "PUT /billing/allocations",
          tenantId,
          actorUserId: userId,
          subjectUserId: body.userId,
          feature: body.feature,
          period: body.period,
          reason: result.reason,
        });
        return reply.code(denialStatus(result.reason)).send({ error: result.reason });
      }

      return reply.code(200).send({
        // `userId` crosses the contract boundary as the branded UserId type; the
        // use case works in plain strings (auth context ids are opaque strings).
        allocation: { ...result.allocation, userId: result.allocation.userId as UserId },
      } satisfies SetMemberAllocationResponse);
    },
  );

  // GET /billing/visibility?period=YYYY-MM
  // ANY active member of the caller's own tenant (NOT owner-only — that is the
  // whole point vs GET /billing/usage above). Returns the tenant billing state
  // (tier/status/trial/override/upgrade prompt), tenant aggregate usage, and
  // ONLY the requester's own member usage. Never another member's usage.
  fastify.get(
    "/billing/visibility",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const query = request.query as { period?: string } | undefined;
      const period =
        query?.period && PERIOD_PATTERN.test(query.period)
          ? query.period
          : currentBillingPeriod(new Date());

      const result = await getBillingVisibility.execute({ tenantId, userId }, period);

      if (!result.ok) {
        return reply.code(denialStatus(result.reason)).send({ error: result.reason });
      }

      return reply.code(200).send(result.visibility satisfies BillingVisibilityDTO);
    },
  );

  // GET /billing/pricing
  // Config-driven display pricing for the web billing screen (11b Slice 5).
  // Any active member may read it (same gate as GET /billing/visibility). The
  // amounts + currency + derived save % come from the Stripe pricing config
  // (env-backed) — so the web renders prices/save badge without ever hardcoding
  // them. No secret is exposed: only display amounts and the currency.
  fastify.get(
    "/billing/pricing",
    { preHandler: requireAuth() },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send(buildBillingPricing() satisfies BillingPricingDTO);
    },
  );

  // POST /billing/checkout
  // Start a Stripe-hosted checkout for a Pro upgrade. Authenticated: only an
  // active member of the caller's own tenant may open checkout. The tenant is
  // read from authContext and stamped as the Stripe client_reference_id /
  // subscription metadata — a `tenantId` (or any tenant field) in the request
  // body is IGNORED, so a spoofed tenant can never be billed or upgraded.
  // Body: CheckoutSessionRequest { cycle: 'monthly'|'annual', promotionCode? }.
  fastify.post(
    "/billing/checkout",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.authContext!;
      const body = request.body as Partial<CheckoutSessionRequest> | null;

      const cycle = body?.cycle;
      if (cycle !== "monthly" && cycle !== "annual") {
        return reply.code(422).send({ error: "invalid_billing_cycle" });
      }

      const promotionCode =
        typeof body?.promotionCode === "string" && body.promotionCode.trim() !== ""
          ? body.promotionCode.trim()
          : undefined;

      try {
        // tenantId comes ONLY from authContext — never from the body.
        const session = await createCheckout.execute({ tenantId, cycle, promotionCode });
        // Deliberately 200 { url }, NOT a 303 redirect (4R FIX 3): the SPA web
        // client performs the redirect itself (window.location = url). Do NOT
        // "fix" this into a server-side redirect — that would break the
        // client's fetch-then-navigate contract (CheckoutSessionResponse).
        return reply.code(200).send({ url: session.url } satisfies CheckoutSessionResponse);
      } catch (error) {
        if (error instanceof InvalidPromotionCodeError) {
          // Our controlled coupon rejection — no session was created.
          return reply.code(422).send({ error: "invalid_promotion_code" });
        }
        // Any other failure (e.g. Stripe unconfigured/unreachable) propagates to
        // the global 500 handler; no partial billing state is exposed.
        throw error;
      }
    },
  );

  // POST /billing/portal
  // Open the Stripe-hosted Customer Portal for the caller's tenant. OWNER-ONLY
  // (11b Slice 4 4R FIX 1): the portal lets the caller change the payment
  // method AND CANCEL THE TENANT'S SUBSCRIPTION, so a non-owner active member
  // is denied 403 before any customer resolution or Stripe call. The tenant is
  // read from authContext and the tenant's stripe_customer_id is resolved
  // SERVER-SIDE from OUR DB — a customerId/tenantId in the request body is
  // IGNORED, so a caller can never open another tenant's portal. A tenant that
  // never subscribed (no stripe_customer_id) gets a clean 409, NOT a 500/crash:
  // a portal cannot exist without a Stripe customer.
  fastify.post(
    "/billing/portal",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const owner = await requireBillingOwner(request, reply, "POST /billing/portal");
      if (!owner) return; // 403 already sent by the guard.

      try {
        // tenantId comes ONLY from authContext — never from the body.
        const session = await createPortalSession.execute({ tenantId: owner.tenantId });
        return reply.code(200).send({ url: session.url } satisfies PortalSessionResponse);
      } catch (error) {
        if (error instanceof NoStripeCustomerError) {
          // Never subscribed → no customer → cannot open a portal. Clean 4xx.
          return reply.code(409).send({ error: "no_stripe_customer" });
        }
        // Any other failure (e.g. Stripe unconfigured/unreachable) propagates to
        // the global 500 handler; no partial billing state is exposed.
        throw error;
      }
    },
  );

  // GET /billing/invoices
  // List the caller's tenant's invoices, read LIVE from Stripe (no local store)
  // and mapped to privacy-safe InvoiceDTOs (no card PAN). OWNER-ONLY (11b Slice
  // 4 4R FIX 1): invoices expose long-lived `hostedInvoiceUrl`/`receiptUrl`
  // links whose PDFs carry the tenant's billing name/address (owner PII), so a
  // non-owner active member is denied 403 before any customer resolution or
  // Stripe call. The tenant is read from authContext and the stripe_customer_id
  // is resolved SERVER-SIDE — any customerId/tenantId in the query is IGNORED,
  // so a caller can only ever see their own tenant's invoices. A tenant that
  // never subscribed returns [] (empty state), NOT an error.
  fastify.get(
    "/billing/invoices",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const owner = await requireBillingOwner(request, reply, "GET /billing/invoices");
      if (!owner) return; // 403 already sent by the guard.

      // tenantId comes ONLY from authContext — never from the query.
      const invoices = await listInvoices.execute({ tenantId: owner.tenantId });
      return reply.code(200).send(invoices satisfies InvoiceDTO[]);
    },
  );
};

/**
 * Stripe webhook plugin (11b-v1-billing-stripe-integration, Slice 2).
 *
 * Registered as its OWN encapsulated Fastify plugin so the raw-body content
 * parser it installs is scoped to THIS instance only — every other JSON route
 * keeps the default parser (minimal blast radius, no global raw-body change).
 *
 * The route is UNAUTHENTICATED by design: the Stripe signature IS the
 * authentication. `ProcessStripeWebhook` verifies the raw bytes against the
 * signing secret before any side effect; an invalid/absent/tampered signature
 * returns 400 with no state write. Any processing error propagates to the
 * global 500 handler so Stripe retries — Pro is never granted on failure
 * (fail-closed). No secret or payload is ever logged.
 */
export interface StripeWebhookRoutesOptions {
  processWebhook: {
    process(
      rawBody: Buffer | string,
      signature: string | undefined,
      now?: Date,
    ): Promise<ProcessWebhookResult>;
  };
}

export const stripeWebhookRoutes: FastifyPluginAsync<StripeWebhookRoutesOptions> = async (
  fastify,
  options,
) => {
  const { processWebhook } = options;
  if (!processWebhook) {
    throw new Error("stripeWebhookRoutes requires a processWebhook use case");
  }

  // RAW body ONLY within this encapsulated scope: Stripe signature
  // verification MUST run over the exact received bytes, so hand the route the
  // untouched Buffer instead of a parsed JSON object.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    },
  );

  fastify.post(
    "/billing/webhook",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const header = request.headers["stripe-signature"];
      const signature = Array.isArray(header) ? header[0] : header;
      const rawBody = request.body as Buffer;

      const result = await processWebhook.process(rawBody, signature);
      if (result.status === "invalid_signature") {
        return reply.code(400).send({ error: "invalid_signature" });
      }
      return reply.code(200).send({ received: true });
    },
  );
};
