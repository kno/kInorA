import { describe, expect, it, vi } from "vitest";
import {
  GetBillingVisibility,
  type BillingVisibilityContext,
  type BillingVisibilityPort,
} from "../billing-visibility.js";

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
