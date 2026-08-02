import { describe, expect, it, vi } from "vitest";
import {
  GetBillingVisibility,
  type BillingVisibilityContext,
  type BillingVisibilityPort,
} from "../billing-visibility.js";
import * as planLimits from "../plan-limits.js";

const SCOPE = { tenantId: "tenant-1", userId: "user-1" };
const PERIOD = "2026-07";
const NOW = new Date("2026-07-23T12:00:00.000Z");

function port(ctx: BillingVisibilityContext): BillingVisibilityPort {
  return {
    loadContext: vi.fn().mockResolvedValue(ctx),
    readTenantUsage: vi.fn().mockResolvedValue([]),
    readOwnMemberUsage: vi.fn().mockResolvedValue([]),
  };
}

function ctx(over: Partial<NonNullable<BillingVisibilityContext["billing"]>>): BillingVisibilityContext {
  return {
    membershipStatus: "active",
    billing: {
      tier: "pro",
      status: "expired",
      source: "system",
      trialStartedAt: null,
      trialEndsAt: null,
      seatCount: null,
      updatedAt: NOW,
      billingCycle: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      ...over,
    },
    activeOverrideTier: null,
    activeOverrideEndsAt: null,
  };
}

describe("GetBillingVisibility — denialReason (#196)", () => {
  it("maps a lapsed trial (status='expired', source='system') to denialReason trial_expired", async () => {
    const uc = new GetBillingVisibility(port(ctx({ source: "system" })));
    const out = await uc.execute(SCOPE, PERIOD, NOW);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.visibility.denialReason).toBe("trial_expired");
      expect(out.visibility.billing.tier).toBe("free");
    }
  });

  it("maps a canceled PAID subscription (status='expired', source='stripe') to denialReason subscription_ended, NOT trial_expired", async () => {
    const uc = new GetBillingVisibility(port(ctx({ source: "stripe" })));
    const out = await uc.execute(SCOPE, PERIOD, NOW);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.visibility.denialReason).toBe("subscription_ended");
      // Tier still lapses to Free — only the reason differs.
      expect(out.visibility.billing.tier).toBe("free");
      expect(out.visibility.upgradePromptPath).toBe("/billing");
    }
  });
});

// ---------------------------------------------------------------------------
// 16c-v3 Slice D (design Q4): the dashboard premium-gate reason
// (billing-visibility.ts:105) must thread seatCount so the displayed limit
// matches actual consumption (Judgment Day CRITICAL — the original plan
// missed this call site).
// ---------------------------------------------------------------------------
describe("GetBillingVisibility — seat-scaled trainer threading (16c-v3 Slice D, Q4)", () => {
  it("passes the context's seatCount through to resolveTenantFeatureLimit for the premium gate", async () => {
    const spy = vi.spyOn(planLimits, "resolveTenantFeatureLimit");
    const uc = new GetBillingVisibility(
      port(ctx({ tier: "trainer", status: "active", source: "backfill", seatCount: 10 })),
    );
    const out = await uc.execute(SCOPE, PERIOD, NOW);
    expect(out.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("trainer", "memory_write", 10);
    spy.mockRestore();
  });

  it("passes null when the context has no seat-billing metadata (regression: byte-identical resolution)", async () => {
    const spy = vi.spyOn(planLimits, "resolveTenantFeatureLimit");
    const uc = new GetBillingVisibility(
      port(ctx({ tier: "trainer", status: "active", source: "backfill", seatCount: null })),
    );
    await uc.execute(SCOPE, PERIOD, NOW);
    expect(spy).toHaveBeenCalledWith("trainer", "memory_write", null);
    spy.mockRestore();
  });
});

describe("GetBillingVisibility — Stripe display fields gated to a paid Pro subscription", () => {
  it("nulls currentPeriodEnd/billingCycle/cancelAtPeriodEnd for a non-paid tenant even if the stored row still carries them", async () => {
    // A canceled/reset tenant whose row still has a lingering Stripe period end
    // must NOT surface a renewal date — it resolves to Free, so there is no
    // paid subscription to renew.
    const uc = new GetBillingVisibility(
      port(
        ctx({
          status: "expired",
          source: "stripe",
          billingCycle: "monthly",
          currentPeriodEnd: new Date("2026-08-27T00:00:00.000Z"),
          cancelAtPeriodEnd: true,
        }),
      ),
    );
    const out = await uc.execute(SCOPE, PERIOD, NOW);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.visibility.billing.tier).toBe("free");
      expect(out.visibility.billing.currentPeriodEnd).toBeNull();
      expect(out.visibility.billing.billingCycle).toBeNull();
      expect(out.visibility.billing.cancelAtPeriodEnd).toBe(false);
    }
  });

  it("exposes currentPeriodEnd/billingCycle for an active PAID Pro (source='stripe') subscription", async () => {
    const uc = new GetBillingVisibility(
      port(
        ctx({
          status: "active",
          source: "stripe",
          billingCycle: "monthly",
          currentPeriodEnd: new Date("2026-08-27T00:00:00.000Z"),
        }),
      ),
    );
    const out = await uc.execute(SCOPE, PERIOD, NOW);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.visibility.billing.tier).toBe("pro");
      expect(out.visibility.billing.currentPeriodEnd).toBe("2026-08-27T00:00:00.000Z");
      expect(out.visibility.billing.billingCycle).toBe("monthly");
    }
  });
});
