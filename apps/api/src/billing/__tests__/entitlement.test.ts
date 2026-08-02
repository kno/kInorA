import { describe, expect, it, vi } from "vitest";
import {
  CheckEntitlement,
  resolveEffectiveTier,
  type EntitlementContext,
  type EntitlementReaderPort,
} from "../entitlement.js";

const SCOPE = { tenantId: "tenant-1", userId: "user-1" };
const NOW = new Date("2026-07-23T12:00:00.000Z");

function reader(ctx: EntitlementContext): EntitlementReaderPort {
  return { loadContext: vi.fn().mockResolvedValue(ctx) };
}

function freeActive(): EntitlementContext {
  return {
    membershipStatus: "active",
    billing: {
      tier: "free",
      status: "active",
      source: "backfill",
      trialStartedAt: null,
      trialEndsAt: null,
    },
    activeOverrideTier: null,
  };
}

function trialing(trialEndsAt: Date): EntitlementContext {
  return {
    membershipStatus: "active",
    billing: {
      tier: "pro",
      status: "trialing",
      source: "system",
      trialStartedAt: new Date("2026-07-01T12:00:00.000Z"),
      trialEndsAt,
    },
    activeOverrideTier: null,
  };
}

/** A trial that lapsed to a persisted `expired` status (system-provisioned). */
function expiredTrial(): EntitlementContext {
  return {
    membershipStatus: "active",
    billing: {
      tier: "pro",
      status: "expired",
      source: "system",
      trialStartedAt: new Date("2026-06-01T12:00:00.000Z"),
      trialEndsAt: new Date("2026-07-01T12:00:00.000Z"),
    },
    activeOverrideTier: null,
  };
}

/** A canceled/ended PAID Stripe subscription — NOT a trial (source `stripe`). */
function canceledPaid(): EntitlementContext {
  return {
    membershipStatus: "active",
    billing: {
      tier: "pro",
      status: "expired",
      source: "stripe",
      trialStartedAt: null,
      trialEndsAt: null,
    },
    activeOverrideTier: null,
  };
}

describe("resolveEffectiveTier", () => {
  it("resolves an active free tenant to free", () => {
    expect(resolveEffectiveTier(freeActive(), NOW)).toEqual({
      tier: "free",
      source: "backfill",
      lapsedReason: null,
    });
  });

  it("resolves an in-window trial to pro", () => {
    const eff = resolveEffectiveTier(trialing(new Date("2026-07-31T12:00:00.000Z")), NOW);
    expect(eff).toEqual({ tier: "pro", source: "system", lapsedReason: null });
  });

  it("resolves an in-flight expired trial to free and flags trial_expired", () => {
    const eff = resolveEffectiveTier(trialing(new Date("2026-07-23T11:59:59.000Z")), NOW);
    expect(eff).toEqual({ tier: "free", source: "system", lapsedReason: "trial_expired" });
  });

  it("treats the exact expiry boundary (now === trialEndsAt) as expired", () => {
    const eff = resolveEffectiveTier(trialing(new Date(NOW)), NOW);
    expect(eff.tier).toBe("free");
    expect(eff.lapsedReason).toBe("trial_expired");
  });

  it("resolves a lapsed trial (persisted status='expired', source='system') to free with trial_expired (#196)", () => {
    const eff = resolveEffectiveTier(expiredTrial(), NOW);
    expect(eff).toEqual({ tier: "free", source: "system", lapsedReason: "trial_expired" });
  });

  it("resolves a canceled PAID subscription (status='expired', source='stripe') to free with subscription_ended, NOT trial_expired (#196)", () => {
    const eff = resolveEffectiveTier(canceledPaid(), NOW);
    // Tier still lapses to Free — only the REASON differs from a lapsed trial.
    expect(eff).toEqual({ tier: "free", source: "stripe", lapsedReason: "subscription_ended" });
  });

  it("lets an active override win over the underlying state with admin_override source", () => {
    const ctx: EntitlementContext = { ...freeActive(), activeOverrideTier: "pro" };
    expect(resolveEffectiveTier(ctx, NOW)).toEqual({
      tier: "pro",
      source: "admin_override",
      lapsedReason: null,
    });
  });

  it("reconciles a lapsed override (status='overridden', no active override row) to the Free baseline, not the stored tier (#172)", () => {
    // A future override-write path could persist tier='pro' + status='overridden'.
    // Once the override window lapses there is NO active override row, so the
    // stored tier must NOT be trusted — the tenant reconciles to Free.
    const ctx: EntitlementContext = {
      membershipStatus: "active",
      billing: {
        tier: "pro",
        status: "overridden",
        source: "admin_override",
        trialStartedAt: null,
        trialEndsAt: null,
      },
      activeOverrideTier: null,
    };
    const eff = resolveEffectiveTier(ctx, NOW);
    expect(eff.tier).toBe("free");
    expect(eff.lapsedReason).toBe(null);
  });
});

describe("CheckEntitlement", () => {
  it("allows a non-premium-blocked feature on Free (plan_generation limit > 0)", async () => {
    const uc = new CheckEntitlement(reader(freeActive()));
    const decision = await uc.check(SCOPE, "plan_generation", NOW);
    expect(decision).toEqual({ allowed: true, tier: "free", source: "backfill", seatCount: null });
  });

  it("denies a premium feature on Free with premium_required (memory_retrieval limit 0)", async () => {
    const uc = new CheckEntitlement(reader(freeActive()));
    const decision = await uc.check(SCOPE, "memory_retrieval", NOW);
    expect(decision).toEqual({ allowed: false, reason: "premium_required" });
  });

  it("allows a premium feature during an active trial", async () => {
    const uc = new CheckEntitlement(reader(trialing(new Date("2026-07-31T12:00:00.000Z"))));
    const decision = await uc.check(SCOPE, "memory_retrieval", NOW);
    expect(decision).toMatchObject({ allowed: true, tier: "pro" });
  });

  it("denies a premium feature after trial expiry with trial_expired", async () => {
    const uc = new CheckEntitlement(reader(trialing(new Date("2026-07-23T11:59:59.000Z"))));
    const decision = await uc.check(SCOPE, "memory_retrieval", NOW);
    expect(decision).toEqual({ allowed: false, reason: "trial_expired" });
  });

  it("denies a premium feature for a lapsed trial (status='expired', source='system') with trial_expired (#196)", async () => {
    const uc = new CheckEntitlement(reader(expiredTrial()));
    const decision = await uc.check(SCOPE, "memory_retrieval", NOW);
    expect(decision).toEqual({ allowed: false, reason: "trial_expired" });
  });

  it("denies a premium feature for a canceled PAID sub (status='expired', source='stripe') with subscription_ended, NOT trial_expired (#196)", async () => {
    const uc = new CheckEntitlement(reader(canceledPaid()));
    const decision = await uc.check(SCOPE, "memory_retrieval", NOW);
    expect(decision).toEqual({ allowed: false, reason: "subscription_ended" });
  });

  it("denies any feature for an inactive membership (fail-closed)", async () => {
    const ctx: EntitlementContext = { ...freeActive(), membershipStatus: "suspended" };
    const uc = new CheckEntitlement(reader(ctx));
    const decision = await uc.check(SCOPE, "plan_generation", NOW);
    expect(decision).toEqual({ allowed: false, reason: "inactive_membership" });
  });

  it("denies when no billing state and no override exist with billing_state_unavailable", async () => {
    const ctx: EntitlementContext = {
      membershipStatus: "active",
      billing: null,
      activeOverrideTier: null,
    };
    const uc = new CheckEntitlement(reader(ctx));
    const decision = await uc.check(SCOPE, "plan_generation", NOW);
    expect(decision).toEqual({ allowed: false, reason: "billing_state_unavailable" });
  });

  it("allows premium via an active override even when billing state resolves to free", async () => {
    const ctx: EntitlementContext = { ...freeActive(), activeOverrideTier: "pro" };
    const uc = new CheckEntitlement(reader(ctx));
    const decision = await uc.check(SCOPE, "memory_retrieval", NOW);
    expect(decision).toEqual({
      allowed: true,
      tier: "pro",
      source: "admin_override",
      seatCount: null,
    });
  });

  it("denies a premium feature for a lapsed override (status='overridden', no active override) — no durable pro (#172)", async () => {
    const ctx: EntitlementContext = {
      membershipStatus: "active",
      billing: {
        tier: "pro",
        status: "overridden",
        source: "admin_override",
        trialStartedAt: null,
        trialEndsAt: null,
      },
      activeOverrideTier: null,
    };
    const uc = new CheckEntitlement(reader(ctx));
    const decision = await uc.check(SCOPE, "memory_retrieval", NOW);
    expect(decision).toEqual({ allowed: false, reason: "premium_required" });
  });
});

// ---------------------------------------------------------------------------
// 16c-v3 Slice D (design Q4) — CheckEntitlement.check threads seatCount into
// its OWN resolveTenantFeatureLimit call (entitlement.ts:135), and surfaces
// the seatCount it used on the allowed decision so downstream callers
// (quota-consumption.ts) never need to re-resolve it.
// ---------------------------------------------------------------------------
function trainerActive(seatCount: number | null): EntitlementContext {
  return {
    membershipStatus: "active",
    billing: {
      tier: "trainer",
      status: "active",
      source: "backfill",
      trialStartedAt: null,
      trialEndsAt: null,
      seatCount,
    },
    activeOverrideTier: null,
  };
}

describe("CheckEntitlement — seat-scaled trainer threading (16c-v3 Slice D, Q4)", () => {
  it("surfaces the raw seatCount from context on the allowed decision", async () => {
    const uc = new CheckEntitlement(reader(trainerActive(5)));
    const decision = await uc.check(SCOPE, "plan_generation", NOW);
    expect(decision).toMatchObject({ allowed: true, tier: "trainer", seatCount: 5 });
  });

  it("a null seatCount on a trainer tenant surfaces seatCount: null (byte-identical to pre-Slice-D)", async () => {
    const uc = new CheckEntitlement(reader(trainerActive(null)));
    const decision = await uc.check(SCOPE, "plan_generation", NOW);
    expect(decision).toMatchObject({ allowed: true, tier: "trainer", seatCount: null });
  });
});
