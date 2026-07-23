import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type {
  BillingFeature,
  SetMemberAllocationRequest,
  SetMemberAllocationResponse,
  TenantUsageReportDTO,
  UserId,
} from "@kinora/contracts";
import { requireAuth } from "../auth/plugin.js";
import { currentBillingPeriod } from "../billing/plan-limits.js";
import type {
  GetTenantUsageOutcome,
  SetMemberAllocationInput,
  SetMemberAllocationOutcome,
} from "../billing/quota-admin.js";

/**
 * Billing quota-administration routes (11a, Phase 3).
 *
 * All routes require an authenticated, ACTIVE membership (the auth plugin
 * re-checks membership status per request, so a suspended actor is rejected
 * with 401 before any handler runs). Tenant + actor identity are ALWAYS read
 * from `request.authContext` — never from the body/params — so a caller can only
 * ever administer their own active tenant (cross-tenant writes are impossible).
 *
 * Privacy boundary: these endpoints expose ONLY aggregate/member usage COUNTS
 * and allocation limits. They never read or return member memories, prompts,
 * health details, or generated private content.
 *
 * Routes:
 *   GET /billing/usage         → owner-only tenant + per-member usage counts
 *   PUT /billing/allocations   → owner-only set a member allocation (audited)
 */
export interface BillingRoutesOptions {
  setMemberAllocation: {
    execute(input: SetMemberAllocationInput): Promise<SetMemberAllocationOutcome>;
  };
  getTenantUsage: {
    execute(input: {
      tenantId: string;
      actorUserId: string;
      period: string;
    }): Promise<GetTenantUsageOutcome>;
  };
}

const VALID_FEATURES: readonly BillingFeature[] = [
  "plan_generation",
  "plan_regeneration",
  "memory_write",
  "memory_retrieval",
];

const PERIOD_PATTERN = /^\d{4}-\d{2}$/;

/**
 * Map a use-case denial reason to an HTTP status. Fail-closed: an authorization
 * failure is 403; an out-of-bounds allocation is a 422 validation error; a
 * missing billing state is 403 (deny rather than expose an unresolved state).
 */
function denialStatus(reason: string): number {
  if (reason === "allocation_out_of_bounds") return 422;
  return 403;
}

export const billingRoutes: FastifyPluginAsync<BillingRoutesOptions> = async (
  fastify,
  options,
) => {
  const { setMemberAllocation, getTenantUsage } = options;

  if (!setMemberAllocation || !getTenantUsage) {
    throw new Error("billingRoutes requires setMemberAllocation and getTenantUsage use cases");
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
        !VALID_FEATURES.includes(body.feature as BillingFeature) ||
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
        return reply.code(denialStatus(result.reason)).send({ error: result.reason });
      }

      return reply.code(200).send({
        // `userId` crosses the contract boundary as the branded UserId type; the
        // use case works in plain strings (auth context ids are opaque strings).
        allocation: { ...result.allocation, userId: result.allocation.userId as UserId },
      } satisfies SetMemberAllocationResponse);
    },
  );
};
