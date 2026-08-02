import { describe, expect, it, vi } from "vitest";
import type { BillingFeature } from "@kinora/contracts";
import type { EntitlementDecision } from "../types.js";
import { resolveTenantFeatureLimit } from "../plan-limits.js";
import { PRO_TIER_LIMITS } from "../pricing-config.js";
import { resolveEffectiveTier, type EntitlementContext } from "../entitlement.js";
import {
  CheckAndConsumeQuota,
  type QuotaLedgerConsumeInput,
  type QuotaLedgerConsumeResult,
  type QuotaLedgerPort,
  type QuotaLedgerRefundResult,
} from "../quota-consumption.js";

// ---------------------------------------------------------------------------
// Slice 3 — REAL metered Pro caps (the point Pro stops being provisionally
// "unlimited"). The provisional PRO_FEATURE_LIMIT = 1_000_000 is GONE:
// resolveTenantFeatureLimit now returns the config-driven PRO_TIER_LIMITS for
// Pro and the FREE_TIER_LIMITS for Free. Over-cap Pro consumption is denied
// with the SAME tenant_quota_exhausted reason a Free tenant hits over its
// limit, and a paid/active subscription supersedes an (even expired) trial.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-23T12:00:00.000Z");
const FEATURES: BillingFeature[] = ["plan_generation", "plan_regeneration", "memory_write", "memory_retrieval"];

describe("resolveTenantFeatureLimit — real Pro caps (11b Slice 3)", () => {
  it("resolves Pro to the config-driven PRO_TIER_LIMITS, NOT the dropped 1_000_000 provisional", () => {
    expect(resolveTenantFeatureLimit("pro", "plan_generation", null)).toBe(500);
    expect(resolveTenantFeatureLimit("pro", "plan_regeneration", null)).toBe(1000);
    expect(resolveTenantFeatureLimit("pro", "memory_write", null)).toBe(50000);
    expect(resolveTenantFeatureLimit("pro", "memory_retrieval", null)).toBe(200000);
    // The provisional cap is gone entirely.
    for (const feature of FEATURES) {
      expect(resolveTenantFeatureLimit("pro", feature, null)).not.toBe(1_000_000);
      expect(resolveTenantFeatureLimit("pro", feature, null)).toBe(PRO_TIER_LIMITS[feature]);
    }
  });

  it("keeps the Free caps unchanged (1 / 1 / 0 / 0)", () => {
    expect(resolveTenantFeatureLimit("free", "plan_generation", null)).toBe(1);
    expect(resolveTenantFeatureLimit("free", "plan_regeneration", null)).toBe(1);
    expect(resolveTenantFeatureLimit("free", "memory_write", null)).toBe(0);
    expect(resolveTenantFeatureLimit("free", "memory_retrieval", null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 15a-v2-trainer-account-access, Slice 1 — dark/additive entitlement
// plumbing. The `trainer` BillingTier must NOT silently fall back to the Free
// caps once it exists in the enum (task 1.4/1.5). No route gates a capability
// on `trainer` yet; this only proves the limit resolver knows about the tier.
// ---------------------------------------------------------------------------
const FREE_TIER_LIMITS_FOR_TEST: Record<BillingFeature, number> = {
  plan_generation: 1,
  plan_regeneration: 1,
  memory_write: 0,
  memory_retrieval: 0,
};

describe("resolveTenantFeatureLimit — trainer tier (15a-v2 Slice 1)", () => {
  it("resolves 'trainer' to TRAINER_TIER_LIMITS, never silently falling back to Free", () => {
    for (const feature of FEATURES) {
      expect(resolveTenantFeatureLimit("trainer", feature, null)).not.toBe(
        FREE_TIER_LIMITS_FOR_TEST[feature],
      );
    }
  });

  it("resolves 'trainer' limits at-or-above the Pro caps for every feature", () => {
    for (const feature of FEATURES) {
      expect(resolveTenantFeatureLimit("trainer", feature, null)).toBeGreaterThanOrEqual(
        PRO_TIER_LIMITS[feature],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 16c-v3 Slice D — seat-scaled trainer limits (design Decision Q4).
// Formula: limit(feature) = max(TRAINER_TIER_LIMITS[feature], seatCount *
// PRO_TIER_LIMITS[feature]). The flat 2x-Pro table is the FLOOR (0-2 seats),
// and a null seatCount MUST fall back to the byte-identical flat table for
// every tier — this is the regression guard against a live-traffic behavior
// change once seat billing goes live.
// ---------------------------------------------------------------------------
describe("resolveTenantFeatureLimit — seat-scaled trainer limits (16c-v3 Slice D, Q4)", () => {
  it("floors at the flat TRAINER_TIER_LIMITS for 0, 1, and 2 seats (never worse off)", () => {
    for (const seatCount of [0, 1, 2]) {
      for (const feature of FEATURES) {
        expect(resolveTenantFeatureLimit("trainer", feature, seatCount)).toBe(
          resolveTenantFeatureLimit("trainer", feature, null),
        );
      }
    }
  });

  it("scales linearly above the floor for 5 and 10 seats: seatCount * PRO_TIER_LIMITS", () => {
    for (const seatCount of [5, 10]) {
      for (const feature of FEATURES) {
        const expected = Math.max(
          resolveTenantFeatureLimit("trainer", feature, null),
          seatCount * PRO_TIER_LIMITS[feature],
        );
        expect(resolveTenantFeatureLimit("trainer", feature, seatCount)).toBe(expected);
        // 5/10 seats is comfortably above the 2x-Pro floor for every feature,
        // so the scaled value must be the one that actually wins the max().
        expect(resolveTenantFeatureLimit("trainer", feature, seatCount)).toBe(
          seatCount * PRO_TIER_LIMITS[feature],
        );
      }
    }
  });

  it("a null seatCount is byte-identical to the pre-Slice-D flat trainer table", () => {
    for (const feature of FEATURES) {
      expect(resolveTenantFeatureLimit("trainer", feature, null)).toBe(
        Math.max(PRO_TIER_LIMITS[feature] * 2, 0),
      );
    }
  });

  it("does NOT scale pro/free/gym regardless of seatCount", () => {
    for (const seatCount of [0, 1, 2, 5, 10]) {
      for (const feature of FEATURES) {
        expect(resolveTenantFeatureLimit("pro", feature, seatCount)).toBe(
          resolveTenantFeatureLimit("pro", feature, null),
        );
        expect(resolveTenantFeatureLimit("free", feature, seatCount)).toBe(
          resolveTenantFeatureLimit("free", feature, null),
        );
        expect(resolveTenantFeatureLimit("gym", feature, seatCount)).toBe(
          resolveTenantFeatureLimit("gym", feature, null),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 16a-v3-gym-white-label, Slice 1 — dark/additive entitlement plumbing. The
// `gym` BillingTier must NOT silently fall back to the Free caps once it
// exists in the enum. No route grants or gates a capability on `gym` yet
// (`assertGymEntitled` lands in Slice 3); this only proves the limit resolver
// knows about the tier.
// ---------------------------------------------------------------------------
describe("resolveTenantFeatureLimit — gym tier (16a-v3 Slice 1)", () => {
  it("resolves 'gym' to GYM_TIER_LIMITS, never silently falling back to Free", () => {
    for (const feature of FEATURES) {
      expect(resolveTenantFeatureLimit("gym", feature, null)).not.toBe(
        FREE_TIER_LIMITS_FOR_TEST[feature],
      );
    }
  });

  it("resolves 'gym' limits at-or-above the Pro caps for every feature", () => {
    for (const feature of FEATURES) {
      expect(resolveTenantFeatureLimit("gym", feature, null)).toBeGreaterThanOrEqual(
        PRO_TIER_LIMITS[feature],
      );
    }
  });
});

// A faithful in-memory ledger: denies once `used >= tenantLimit`, mirroring the
// real atomic conditional UPDATE ... WHERE used < limit (same shape as the
// quota-consumption unit suite).
class FakeLedger implements QuotaLedgerPort {
  constructor(private used: number) {}
  lastLimit = 0;
  async consume(input: QuotaLedgerConsumeInput): Promise<QuotaLedgerConsumeResult> {
    this.lastLimit = input.tenantLimit;
    if (this.used >= input.tenantLimit) return { outcome: "denied", reason: "tenant_quota_exhausted" };
    this.used += 1;
    return { outcome: "consumed" };
  }
  async refund(): Promise<QuotaLedgerRefundResult> {
    return { outcome: "noop" };
  }
}

function proEntitlement() {
  return {
    check: vi.fn(
      async (): Promise<EntitlementDecision> => ({
        allowed: true,
        tier: "pro",
        source: "stripe",
        seatCount: null,
      }),
    ),
  };
}

describe("Pro metered enforcement end-to-end (11b Slice 3)", () => {
  it("allows a Pro consumption UNDER the real cap and charges against the real cap", async () => {
    const ledger = new FakeLedger(499); // one unit left under the 500 plan_generation cap
    const uc = new CheckAndConsumeQuota(proEntitlement(), ledger);

    const decision = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "op-1", NOW);

    expect(decision).toMatchObject({ allowed: true, tier: "pro" });
    // The consume was metered against the REAL Pro cap, not the old 1_000_000.
    expect(ledger.lastLimit).toBe(500);
  });

  it("denies a Pro consumption OVER the real cap with tenant_quota_exhausted (like Free over limit)", async () => {
    const ledger = new FakeLedger(500); // already at the plan_generation cap
    const uc = new CheckAndConsumeQuota(proEntitlement(), ledger);

    const decision = await uc.checkAndConsume({ tenantId: "t", userId: "u" }, "plan_generation", "op-2", NOW);

    expect(decision).toEqual({ allowed: false, reason: "tenant_quota_exhausted" });
    expect(ledger.lastLimit).toBe(500);
  });
});

describe("a paid/active subscription supersedes trial (11b Slice 3)", () => {
  it("resolves an ACTIVE paid (source=stripe) tenant to Pro even when a trial window has lapsed", () => {
    const ctx: EntitlementContext = {
      membershipStatus: "active",
      billing: {
        tier: "pro",
        status: "active",
        source: "stripe",
        // A stale trial window from before the paid upgrade must NOT downgrade a paid tenant.
        trialStartedAt: new Date("2026-06-01T00:00:00.000Z"),
        trialEndsAt: new Date("2026-06-15T00:00:00.000Z"),
      },
      activeOverrideTier: null,
    };

    const eff = resolveEffectiveTier(ctx, NOW);

    expect(eff.tier).toBe("pro");
    expect(eff.source).toBe("stripe");
    expect(eff.lapsedReason).toBe(null);
  });
});
