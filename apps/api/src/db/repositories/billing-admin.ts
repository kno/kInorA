import { and, eq, gt, lte } from "drizzle-orm";
import type { Database } from "../client.js";
import {
  billingAuditEvents,
  memberQuotaAllocations,
  memberQuotaCounters,
  memberships,
  tenantBillingOverrides,
  tenantBillingStates,
  tenantQuotaCounters,
} from "../schema.js";
import type { MemberQuotaUsageDTO, TenantQuotaUsageDTO, UserId } from "@kinora/contracts";
import { resolveEffectiveTier, type EntitlementContext } from "../../billing/entitlement.js";
import type {
  AdminMembershipView,
  QuotaAdminPort,
  SetMemberAllocationInput,
} from "../../billing/quota-admin.js";
import type { BillingScope } from "../../billing/types.js";

/**
 * Drizzle adapter for the quota-administration port. Lives under `db/` because
 * `.dependency-cruiser.cjs` forbids importing drizzle/pg outside the infra
 * layer; the pure `SetMemberAllocation` / `GetTenantUsage` use cases in
 * `billing/` depend only on the port interface.
 *
 * Every query is scoped by `tenant_id` (and `user_id` for member reads), so no
 * cross-tenant row is ever read or written. Reads return count/limit columns
 * ONLY — this adapter never selects memory, prompt, health, or plan-content
 * tables, enforcing the quota privacy boundary at the persistence layer.
 */
export class BillingAdminRepository implements QuotaAdminPort {
  constructor(private readonly db: Database) {}

  async loadActorMembership(scope: BillingScope): Promise<AdminMembershipView | null> {
    return this.loadMembership(scope.tenantId, scope.userId);
  }

  async loadSubjectMembership(
    tenantId: string,
    subjectUserId: string,
  ): Promise<AdminMembershipView | null> {
    return this.loadMembership(tenantId, subjectUserId);
  }

  private async loadMembership(
    tenantId: string,
    userId: string,
  ): Promise<AdminMembershipView | null> {
    const [row] = await this.db
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    return row ? { role: row.role, status: row.status } : null;
  }

  async loadTenantTier(tenantId: string, now: Date): Promise<"free" | "pro" | null> {
    const [billingRow] = await this.db
      .select({
        tier: tenantBillingStates.tier,
        status: tenantBillingStates.status,
        source: tenantBillingStates.source,
        trialStartedAt: tenantBillingStates.trialStartedAt,
        trialEndsAt: tenantBillingStates.trialEndsAt,
      })
      .from(tenantBillingStates)
      .where(eq(tenantBillingStates.tenantId, tenantId));

    const [overrideRow] = await this.db
      .select({ tier: tenantBillingOverrides.tier })
      .from(tenantBillingOverrides)
      .where(
        and(
          eq(tenantBillingOverrides.tenantId, tenantId),
          lte(tenantBillingOverrides.startsAt, now),
          gt(tenantBillingOverrides.endsAt, now),
        ),
      )
      .orderBy(tenantBillingOverrides.endsAt);

    if (!billingRow && !overrideRow) {
      return null;
    }

    const ctx: EntitlementContext = {
      membershipStatus: "active",
      billing: billingRow
        ? {
            tier: billingRow.tier,
            status: billingRow.status,
            source: billingRow.source,
            trialStartedAt: billingRow.trialStartedAt,
            trialEndsAt: billingRow.trialEndsAt,
          }
        : null,
      activeOverrideTier: overrideRow?.tier ?? null,
    };

    return resolveEffectiveTier(ctx, now).tier;
  }

  /**
   * Atomic allocation upsert + audit write in a single transaction. The audit
   * row records the acting owner (`actor_user_id`), the target member
   * (`subject_user_id`), the feature/period, and the new limit in `metadata`.
   */
  async writeMemberAllocation(input: SetMemberAllocationInput): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(memberQuotaAllocations)
        .values({
          tenantId: input.tenantId,
          userId: input.subjectUserId,
          feature: input.feature,
          period: input.period,
          limit: input.limit,
          updatedByUserId: input.actorUserId,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            memberQuotaAllocations.tenantId,
            memberQuotaAllocations.userId,
            memberQuotaAllocations.feature,
            memberQuotaAllocations.period,
          ],
          set: {
            limit: input.limit,
            updatedByUserId: input.actorUserId,
            updatedAt: now,
          },
        });

      await tx.insert(billingAuditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        subjectUserId: input.subjectUserId,
        action: "member_allocation_set",
        feature: input.feature,
        period: input.period,
        metadata: { limit: input.limit },
      });
    });
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
      .where(
        and(eq(tenantQuotaCounters.tenantId, tenantId), eq(tenantQuotaCounters.period, period)),
      );

    return rows.map((r) => ({
      feature: r.feature,
      period: r.period,
      used: r.used,
      limit: r.limit,
    }));
  }

  async readMemberUsage(tenantId: string, period: string): Promise<MemberQuotaUsageDTO[]> {
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
        and(eq(memberQuotaCounters.tenantId, tenantId), eq(memberQuotaCounters.period, period)),
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
