import type {
  BillingDenialReason,
  BillingSource,
  BillingStatus,
  BillingTier,
  BillingVisibilityDTO,
  MemberQuotaUsageDTO,
  TenantBillingStateDTO,
  TenantId,
  TenantQuotaUsageDTO,
} from "@kinora/contracts";
import type { BillingScope } from "./types.js";
import { resolveEffectiveTier } from "./entitlement.js";
import { resolveTenantFeatureLimit } from "./plan-limits.js";

export type MembershipStatus = "invited" | "active" | "suspended";

/**
 * Context needed to resolve tenant billing state visible to a requesting
 * member. Structurally compatible with `EntitlementContext` (see
 * `entitlement.ts`) so `resolveEffectiveTier` can consume it directly, with
 * the extra fields (`billing.updatedAt`, `activeOverrideEndsAt`) needed to
 * populate `TenantBillingStateDTO` for the UI.
 */
export interface BillingVisibilityContext {
  membershipStatus: MembershipStatus | null;
  billing: {
    tier: BillingTier;
    status: BillingStatus;
    source: BillingSource;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    updatedAt: Date;
  } | null;
  activeOverrideTier: BillingTier | null;
  /** `endsAt` of the currently active override, or null when none is active. */
  activeOverrideEndsAt: Date | null;
}

export interface BillingVisibilityPort {
  loadContext(scope: BillingScope): Promise<BillingVisibilityContext>;
  /** Tenant aggregate usage counts for the period (no content, no per-member breakdown). */
  readTenantUsage(tenantId: string, period: string): Promise<TenantQuotaUsageDTO[]>;
  /**
   * Usage counts for ONLY the requesting member (`userId`) — never any other
   * member's usage. This is the structural privacy boundary for this read:
   * the port has no method that could return another member's counters.
   */
  readOwnMemberUsage(tenantId: string, userId: string, period: string): Promise<MemberQuotaUsageDTO[]>;
}

export type GetBillingVisibilityOutcome =
  | { ok: true; visibility: BillingVisibilityDTO }
  | { ok: false; reason: BillingDenialReason };

/**
 * Member-facing billing visibility read (`GetBillingVisibility` use case,
 * spec `Billing State Visibility`). Unlike `GetTenantUsage` (owner-only,
 * Slice 3 quota administration), this is available to ANY active member of
 * the tenant and returns ONLY: the tenant's billing state (tier/status/
 * trial/override/upgrade prompt), tenant aggregate usage, and the
 * REQUESTING member's own usage. It never exposes another member's
 * individual usage, memories, prompts, health details, or generated private
 * content — the port's type surface structurally cannot return them (see
 * `readOwnMemberUsage`, which is always called with the caller's own
 * `scope.userId`, never a value from the request body/query).
 *
 * Fail-closed: inactive membership or a missing billing state (and no
 * active override) deny before any usage read.
 */
export class GetBillingVisibility {
  constructor(private readonly port: BillingVisibilityPort) {}

  async execute(
    scope: BillingScope,
    period: string,
    now: Date = new Date(),
  ): Promise<GetBillingVisibilityOutcome> {
    const ctx = await this.port.loadContext(scope);

    if (ctx.membershipStatus !== "active") {
      return { ok: false, reason: "inactive_membership" };
    }

    if (!ctx.billing && !ctx.activeOverrideTier) {
      return { ok: false, reason: "billing_state_unavailable" };
    }

    const effective = resolveEffectiveTier(ctx, now);
    // Premium-gate visibility uses `memory_write` (0 for Free/expired trial)
    // as the representative premium feature, mirroring the denial
    // `CheckEntitlement` would produce for any premium AI action right now —
    // so the UI shows the SAME upgrade prompt without duplicating gate logic
    // per feature.
    const premiumLimit = resolveTenantFeatureLimit(effective.tier, "memory_write");
    const denialReason: BillingDenialReason | undefined =
      premiumLimit <= 0 ? (effective.trialExpired ? "trial_expired" : "premium_required") : undefined;

    const [tenantUsage, memberUsage] = await Promise.all([
      this.port.readTenantUsage(scope.tenantId, period),
      this.port.readOwnMemberUsage(scope.tenantId, scope.userId, period),
    ]);

    const billing: TenantBillingStateDTO = {
      tenantId: scope.tenantId as TenantId,
      tier: effective.tier,
      status: ctx.billing?.status ?? "overridden",
      source: effective.source,
      trialStartedAt: ctx.billing?.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: ctx.billing?.trialEndsAt?.toISOString() ?? null,
      activeOverrideEndsAt: ctx.activeOverrideEndsAt?.toISOString() ?? null,
      updatedAt: (ctx.billing?.updatedAt ?? now).toISOString(),
    };

    return {
      ok: true,
      visibility: {
        billing,
        tenantUsage,
        memberUsage,
        // The upgrade prompt destination is the billing page itself: 11a has
        // no Stripe/checkout page (explicitly out of scope), so the prompt
        // routes the member to the billing view that shows the CTA.
        ...(denialReason ? { denialReason, upgradePromptPath: "/billing" } : {}),
      },
    };
  }
}
