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

describe("resolveEffectiveTier", () => {
  it("resolves an active free tenant to free", () => {
    expect(resolveEffectiveTier(freeActive(), NOW)).toEqual({
      tier: "free",
      source: "backfill",
      trialExpired: false,
    });
  });

  it("resolves an in-window trial to pro", () => {
    const eff = resolveEffectiveTier(trialing(new Date("2026-07-31T12:00:00.000Z")), NOW);
    expect(eff).toEqual({ tier: "pro", source: "system", trialExpired: false });
  });

  it("resolves an expired trial to free and flags trialExpired", () => {
    const eff = resolveEffectiveTier(trialing(new Date("2026-07-23T11:59:59.000Z")), NOW);
    expect(eff).toEqual({ tier: "free", source: "system", trialExpired: true });
  });

  it("treats the exact expiry boundary (now === trialEndsAt) as expired", () => {
    const eff = resolveEffectiveTier(trialing(new Date(NOW)), NOW);
    expect(eff.tier).toBe("free");
    expect(eff.trialExpired).toBe(true);
  });

  it("lets an active override win over the underlying state with admin_override source", () => {
    const ctx: EntitlementContext = { ...freeActive(), activeOverrideTier: "pro" };
    expect(resolveEffectiveTier(ctx, NOW)).toEqual({
      tier: "pro",
      source: "admin_override",
      trialExpired: false,
    });
  });
});

describe("CheckEntitlement", () => {
  it("allows a non-premium-blocked feature on Free (plan_generation limit > 0)", async () => {
    const uc = new CheckEntitlement(reader(freeActive()));
    const decision = await uc.check(SCOPE, "plan_generation", NOW);
    expect(decision).toEqual({ allowed: true, tier: "free", source: "backfill" });
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
    expect(decision).toEqual({ allowed: true, tier: "pro", source: "admin_override" });
  });
});
