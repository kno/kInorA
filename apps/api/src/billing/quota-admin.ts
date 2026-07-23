import type {
  BillingDenialReason,
  BillingFeature,
  BillingTier,
  MemberQuotaUsageDTO,
  TenantQuotaUsageDTO,
} from "@kinora/contracts";
import type { BillingScope } from "./types.js";
import { PERIOD_PATTERN, resolveTenantFeatureLimit } from "./plan-limits.js";

/**
 * Membership view needed for quota-admin authorization: the actor/subject role
 * and status within a SINGLE tenant. Trainer-managed tenants have no distinct
 * "trainer" role — the tenant creator is the `owner` (see provisioning.ts and
 * the `membership_role` enum), so an authorized quota administrator is an
 * ACTIVE OWNER of the tenant.
 */
export interface AdminMembershipView {
  role: "owner" | "member";
  status: "invited" | "active" | "suspended";
}

/**
 * Input to set a per-member allocation. `tenantId` and `actorUserId` are always
 * taken from the request auth context (never the request body) so a caller can
 * only ever administer their OWN active tenant — cross-tenant writes are
 * structurally impossible.
 */
export interface SetMemberAllocationInput {
  tenantId: string;
  actorUserId: string;
  subjectUserId: string;
  feature: BillingFeature;
  period: string;
  limit: number;
}

/**
 * Quota-administration port. Every method is tenant-scoped and returns ONLY
 * counts/limits/membership metadata. There is deliberately NO method that could
 * return a member's memories, prompts, health details, or generated private
 * content — the privacy boundary is enforced by this type surface.
 */
export interface QuotaAdminPort {
  /** The actor's membership (role + status) in the tenant, or null when none. */
  loadActorMembership(scope: BillingScope): Promise<AdminMembershipView | null>;
  /** The subject member's membership in the SAME tenant, or null when not a member. */
  loadSubjectMembership(
    tenantId: string,
    subjectUserId: string,
  ): Promise<AdminMembershipView | null>;
  /** Effective tenant tier used to bound allocations, or null when no billing state. */
  loadTenantTier(tenantId: string, now: Date): Promise<BillingTier | null>;
  /**
   * Atomic: upsert the `(tenantId, subjectUserId, feature, period)` allocation
   * AND write the `member_allocation_set` audit row in ONE transaction. The
   * transaction is owned by the adapter; the use case never sees it.
   */
  writeMemberAllocation(input: SetMemberAllocationInput): Promise<void>;
  /** Tenant aggregate usage counts for the period (no content). */
  readTenantUsage(tenantId: string, period: string): Promise<TenantQuotaUsageDTO[]>;
  /** Per-member usage counts for the period (no content). */
  readMemberUsage(tenantId: string, period: string): Promise<MemberQuotaUsageDTO[]>;
}

export type SetMemberAllocationOutcome =
  | {
      ok: true;
      allocation: { userId: string; feature: BillingFeature; period: string; limit: number };
    }
  | { ok: false; reason: BillingDenialReason };

export type GetTenantUsageOutcome =
  | { ok: true; tenantUsage: TenantQuotaUsageDTO[]; memberUsage: MemberQuotaUsageDTO[] }
  | { ok: false; reason: BillingDenialReason };

/**
 * Input to read tenant + per-member usage counts. Named (mirrors
 * {@link SetMemberAllocationInput}) so the route options and the use case share
 * one shape instead of duplicating an anonymous object type.
 */
export interface GetTenantUsageInput {
  tenantId: string;
  actorUserId: string;
  period: string;
}

/**
 * True when the actor is an ACTIVE OWNER of the tenant. Fail-closed: a missing
 * membership, non-owner role, or non-active status is never authorized.
 */
function isActiveOwner(actor: AdminMembershipView | null): boolean {
  return actor !== null && actor.status === "active" && actor.role === "owner";
}

/**
 * Set a per-member quota allocation (`SetMemberAllocation` use case).
 *
 * Authorization (fail-closed):
 *   - the actor MUST be an active owner of the tenant, else `unauthorized_quota_admin`.
 *   - the subject MUST be a member of the SAME tenant, else `unauthorized_quota_admin`
 *     (this is the cross-tenant guard — a subject in another tenant is denied and
 *     no other-tenant data is read or returned). An owner MAY set the allocation of
 *     a suspended/invited member (management follows membership policy); consumption
 *     for a non-active member stays blocked separately by CheckEntitlement.
 *
 * Plan bounds: `limit` MUST be a non-negative integer within the tenant's resolved
 * plan cap for the feature, else `allocation_out_of_bounds`.
 *
 * On success, delegates the atomic allocation upsert + audit write to the port.
 */
export class SetMemberAllocation {
  constructor(private readonly port: QuotaAdminPort) {}

  async execute(
    input: SetMemberAllocationInput,
    now: Date = new Date(),
  ): Promise<SetMemberAllocationOutcome> {
    const actor = await this.port.loadActorMembership({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (!isActiveOwner(actor)) {
      return { ok: false, reason: "unauthorized_quota_admin" };
    }

    const subject = await this.port.loadSubjectMembership(input.tenantId, input.subjectUserId);
    if (!subject) {
      // Not a member of the actor's tenant → cross-tenant / unknown subject.
      return { ok: false, reason: "unauthorized_quota_admin" };
    }

    if (
      !Number.isInteger(input.limit) ||
      input.limit < 0 ||
      !PERIOD_PATTERN.test(input.period)
    ) {
      return { ok: false, reason: "allocation_out_of_bounds" };
    }

    const tier = await this.port.loadTenantTier(input.tenantId, now);
    if (!tier) {
      return { ok: false, reason: "billing_state_unavailable" };
    }

    const cap = resolveTenantFeatureLimit(tier, input.feature);
    if (input.limit > cap) {
      return { ok: false, reason: "allocation_out_of_bounds" };
    }

    await this.port.writeMemberAllocation(input);

    return {
      ok: true,
      allocation: {
        userId: input.subjectUserId,
        feature: input.feature,
        period: input.period,
        limit: input.limit,
      },
    };
  }
}

/**
 * Read tenant + per-member usage counts (`GetTenantUsage` use case).
 *
 * Owner-only (fail-closed). Returns aggregate tenant counts and per-member usage
 * counts ONLY — never member memories, prompts, health details, or generated
 * private content. Tenant scope is the actor's own tenant; no cross-tenant read.
 */
export class GetTenantUsage {
  constructor(private readonly port: QuotaAdminPort) {}

  async execute(input: GetTenantUsageInput): Promise<GetTenantUsageOutcome> {
    const actor = await this.port.loadActorMembership({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (!isActiveOwner(actor)) {
      return { ok: false, reason: "unauthorized_quota_admin" };
    }

    const tenantUsage = await this.port.readTenantUsage(input.tenantId, input.period);
    const memberUsage = await this.port.readMemberUsage(input.tenantId, input.period);

    return { ok: true, tenantUsage, memberUsage };
  }
}
