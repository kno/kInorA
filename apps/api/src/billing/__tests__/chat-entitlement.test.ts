import { describe, expect, it, vi } from "vitest";
import { ChatEntitlement } from "../chat-entitlement.js";
import type { EntitlementContext, EntitlementReaderPort } from "../entitlement.js";

const SCOPE = { tenantId: "tenant-1", userId: "user-1" };
const NOW = new Date("2026-07-23T12:00:00.000Z");

function reader(ctx: EntitlementContext): EntitlementReaderPort {
  return { loadContext: vi.fn().mockResolvedValue(ctx) };
}

function proActive(): EntitlementContext {
  return {
    membershipStatus: "active",
    billing: {
      tier: "pro",
      status: "active",
      source: "stripe",
      trialStartedAt: null,
      trialEndsAt: null,
    },
    activeOverrideTier: null,
  };
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

describe("ChatEntitlement.check", () => {
  it("allows a Pro tenant", async () => {
    const gate = new ChatEntitlement(reader(proActive()));
    expect(await gate.check(SCOPE, NOW)).toEqual({ allowed: true });
  });

  it("allows a tenant granted Pro by an active admin override", async () => {
    const ctx: EntitlementContext = {
      membershipStatus: "active",
      billing: null,
      activeOverrideTier: "pro",
    };
    const gate = new ChatEntitlement(reader(ctx));
    expect(await gate.check(SCOPE, NOW)).toEqual({ allowed: true });
  });

  it("denies a Free tenant with premium_required", async () => {
    const gate = new ChatEntitlement(reader(freeActive()));
    expect(await gate.check(SCOPE, NOW)).toEqual({
      allowed: false,
      reason: "premium_required",
    });
  });

  it("denies an expired-trial tenant with trial_expired", async () => {
    const gate = new ChatEntitlement(reader(expiredTrial()));
    expect(await gate.check(SCOPE, NOW)).toEqual({
      allowed: false,
      reason: "trial_expired",
    });
  });

  it("denies a canceled paid subscription with subscription_ended", async () => {
    const gate = new ChatEntitlement(reader(canceledPaid()));
    expect(await gate.check(SCOPE, NOW)).toEqual({
      allowed: false,
      reason: "subscription_ended",
    });
  });

  it("fails closed for an inactive membership before resolving tier", async () => {
    const ctx: EntitlementContext = { ...proActive(), membershipStatus: "suspended" };
    const load = vi.fn().mockResolvedValue(ctx);
    const gate = new ChatEntitlement({ loadContext: load });
    expect(await gate.check(SCOPE, NOW)).toEqual({
      allowed: false,
      reason: "inactive_membership",
    });
  });

  it("fails closed when billing state is unavailable", async () => {
    const ctx: EntitlementContext = {
      membershipStatus: "active",
      billing: null,
      activeOverrideTier: null,
    };
    const gate = new ChatEntitlement(reader(ctx));
    expect(await gate.check(SCOPE, NOW)).toEqual({
      allowed: false,
      reason: "billing_state_unavailable",
    });
  });

  it("resolves identity ONLY from the passed scope (no body-derived tier/tenant)", async () => {
    // Threat Matrix: tier/tenant spoof via body. The port takes only a
    // BillingScope; there is no channel for a body-injected tenantId/tier. The
    // reader is called with EXACTLY the scope the route sourced from authContext.
    const load = vi.fn().mockResolvedValue(freeActive());
    const gate = new ChatEntitlement({ loadContext: load });
    const decision = await gate.check(SCOPE, NOW);
    expect(load).toHaveBeenCalledWith(SCOPE);
    expect(decision).toEqual({ allowed: false, reason: "premium_required" });
  });
});
