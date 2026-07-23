import { and, eq, gt, lte } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  memberQuotaCounters,
  memberships,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
} from "../schema.js";
import type { MemberQuotaUsageDTO, TenantQuotaUsageDTO, UserId } from "@kinora/contracts";
import type {
  BillingVisibilityContext,
  BillingVisibilityPort,
} from "../../billing/billing-visibility.js";
import type { BillingScope } from "../../billing/types.js";

/**
 * Drizzle adapter for the member-facing billing visibility port. Lives under
 * `db/` because `.dependency-cruiser.cjs` forbids importing drizzle/pg
 * outside the infra layer; the pure `GetBillingVisibility` use case depends
 * only on the port interface.
 *
 * `readOwnMemberUsage` is ALWAYS filtered by the caller-supplied `userId`
 * (which the route always sources from `authContext`, never the request) —
 * this adapter has no method that reads another member's usage, memories,
 * prompts, health details, or generated content.
 */
export class BillingVisibilityRepository implements BillingVisibilityPort {
  constructor(private readonly db: Database) {}

  async loadContext(scope: BillingScope): Promise<BillingVisibilityContext> {
    const now = new Date();

    const [membershipRow] = await this.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.userId, scope.userId)));

    const [billingRow] = await this.db
      .select({
        tier: tenantBillingStates.tier,
        status: tenantBillingStates.status,
        source: tenantBillingStates.source,
        trialStartedAt: tenantBillingStates.trialStartedAt,
        trialEndsAt: tenantBillingStates.trialEndsAt,
        updatedAt: tenantBillingStates.updatedAt,
      })
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, scope.tenantId));

    const [overrideRow] = await this.db
      .select({ tier: tenantBillingOverrides.tier, endsAt: tenantBillingOverrides.endsAt })
      .from(tenantBillingOverrides)
      .where(
        and(
          eq(tenantBillingOverrides.tenantId, scope.tenantId),
          lte(tenantBillingOverrides.startsAt, now),
          gt(tenantBillingOverrides.endsAt, now),
        ),
      )
      .orderBy(tenantBillingOverrides.endsAt);

    return {
      membershipStatus: membershipRow?.status ?? null,
      billing: billingRow
        ? {
            tier: billingRow.tier,
            status: billingRow.status,
            source: billingRow.source,
            trialStartedAt: billingRow.trialStartedAt,
            trialEndsAt: billingRow.trialEndsAt,
            updatedAt: billingRow.updatedAt,
          }
        : null,
      activeOverrideTier: overrideRow?.tier ?? null,
      activeOverrideEndsAt: overrideRow?.endsAt ?? null,
    };
  }

  async readTenantUsage(tenantId: string, period: string): Promise<TenantQuotaUsageDTO[]> {
    const rows = await this.db
      .select({
        feature: tenantQuotaCounters.feature,
        period: tenantQuotaCounters.period,
        used: tenantQuotaCounters.used,
        limit: tenantQuotaCounters.limit,
      })
      .from(tenantQuotaCounters)
      .where(and(eq(tenantQuotaCounters.tenantId, tenantId), eq(tenantQuotaCounters.period, period)));

    return rows.map((r) => ({ feature: r.feature, period: r.period, used: r.used, limit: r.limit }));
  }

  async readOwnMemberUsage(
    tenantId: string,
    userId: string,
    period: string,
  ): Promise<MemberQuotaUsageDTO[]> {
    const rows = await this.db
      .select({
        userId: memberQuotaCounters.userId,
        feature: memberQuotaCounters.feature,
        period: memberQuotaCounters.period,
        used: memberQuotaCounters.used,
        limit: memberQuotaCounters.limit,
      })
      .from(memberQuotaCounters)
      .where(
        and(
          eq(memberQuotaCounters.tenantId, tenantId),
          eq(memberQuotaCounters.userId, userId),
          eq(memberQuotaCounters.period, period),
        ),
      );

    return rows.map((r) => ({
      userId: r.userId as UserId,
      feature: r.feature,
      period: r.period,
      used: r.used,
      limit: r.limit,
    }));
  }
}
