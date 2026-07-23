import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type {
  BillingFeature,
  BillingVisibilityDTO,
  SetMemberAllocationRequest,
  SetMemberAllocationResponse,
  TenantUsageReportDTO,
  UserId,
} from "@kinora/contracts";
import { BILLING_FEATURES } from "@kinora/contracts";
import { requireAuth } from "../auth/plugin.js";
import { PERIOD_PATTERN, currentBillingPeriod } from "../billing/plan-limits.js";
import type {
  GetTenantUsageInput,
  GetTenantUsageOutcome,
  SetMemberAllocationInput,
  SetMemberAllocationOutcome,
} from "../billing/quota-admin.js";
import type { GetBillingVisibilityOutcome } from "../billing/billing-visibility.js";

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
  const { setMemberAllocation, getTenantUsage, getBillingVisibility } = options;

  if (!setMemberAllocation || !getTenantUsage || !getBillingVisibility) {
    throw new Error(
      "billingRoutes requires setMemberAllocation, getTenantUsage, and getBillingVisibility use cases",
    );
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
};
