import { describe, expect, it, vi } from "vitest";
import {
  SetMemberAllocation,
  type AdminMembershipView,
  type QuotaAdminPort,
  type SetMemberAllocationInput,
} from "../quota-admin.js";
import * as planLimits from "../plan-limits.js";

const TENANT_ID = "tenant-1";
const ACTOR_ID = "owner-1";
const SUBJECT_ID = "member-1";
const NOW = new Date("2026-07-23T12:00:00.000Z");

const OWNER_ACTIVE: AdminMembershipView = { role: "owner", status: "active" };
const MEMBER_ACTIVE: AdminMembershipView = { role: "member", status: "active" };

function buildInput(overrides: Partial<SetMemberAllocationInput> = {}): SetMemberAllocationInput {
  return {
    tenantId: TENANT_ID,
    actorUserId: ACTOR_ID,
    subjectUserId: SUBJECT_ID,
    feature: "plan_generation",
    period: "2026-07",
    limit: 5,
    ...overrides,
  };
}

function buildPort(
  tenantBilling: { tier: "free" | "pro" | "trainer" | "gym"; seatCount: number | null } | null,
): QuotaAdminPort {
  return {
    loadActorMembership: vi.fn(async () => OWNER_ACTIVE),
    loadSubjectMembership: vi.fn(async () => MEMBER_ACTIVE),
    loadTenantTier: vi.fn(async () => tenantBilling),
    writeMemberAllocation: vi.fn(async () => {}),
    readTenantUsage: vi.fn(async () => []),
    readMemberUsage: vi.fn(async () => []),
  };
}

// ---------------------------------------------------------------------------
// 16c-v3 Slice D (design Q4): `SetMemberAllocation` (quota-admin.ts:153) must
// thread the tenant's persisted seatCount into `resolveTenantFeatureLimit` so
// an admin CAN allocate above the flat 2x-Pro cap when the tenant's true
// seat-scaled cap is far higher (Judgment Day CRITICAL — the original plan
// missed this call site, producing `allocation_out_of_bounds` false negatives).
// ---------------------------------------------------------------------------
describe("SetMemberAllocation — seat-scaled trainer threading (16c-v3 Slice D, Q4)", () => {
  it("passes the tenant's seatCount into resolveTenantFeatureLimit when bounding the allocation cap", async () => {
    const spy = vi.spyOn(planLimits, "resolveTenantFeatureLimit");
    const uc = new SetMemberAllocation(buildPort({ tier: "trainer", seatCount: 10 }));

    await uc.execute(buildInput({ limit: 5 }), NOW);

    expect(spy).toHaveBeenCalledWith("trainer", "plan_generation", 10);
    spy.mockRestore();
  });

  it("allows an allocation ABOVE the flat 2x-Pro cap for a seat-scaled trainer tenant", async () => {
    // Flat trainer cap for plan_generation is 2*500=1000; a 10-seat trainer
    // scales to 10*500=5000 — an allocation of 2000 must be ALLOWED, which
    // the flat table alone would have rejected as allocation_out_of_bounds.
    const port = buildPort({ tier: "trainer", seatCount: 10 });
    const uc = new SetMemberAllocation(port);

    const outcome = await uc.execute(buildInput({ limit: 2000 }), NOW);

    expect(outcome).toEqual({
      ok: true,
      allocation: { userId: SUBJECT_ID, feature: "plan_generation", period: "2026-07", limit: 2000 },
    });
    expect(port.writeMemberAllocation).toHaveBeenCalled();
  });

  it("rejects the SAME above-flat-cap allocation for a null-seatCount trainer tenant (regression: unchanged behavior)", async () => {
    const port = buildPort({ tier: "trainer", seatCount: null });
    const uc = new SetMemberAllocation(port);

    const outcome = await uc.execute(buildInput({ limit: 2000 }), NOW);

    expect(outcome).toEqual({ ok: false, reason: "allocation_out_of_bounds" });
    expect(port.writeMemberAllocation).not.toHaveBeenCalled();
  });

  it("passes null seatCount for pro/free tenants regardless of any stored value (formula ignores it)", async () => {
    const spy = vi.spyOn(planLimits, "resolveTenantFeatureLimit");
    const uc = new SetMemberAllocation(buildPort({ tier: "pro", seatCount: null }));

    await uc.execute(buildInput({ limit: 5 }), NOW);

    expect(spy).toHaveBeenCalledWith("pro", "plan_generation", null);
    spy.mockRestore();
  });
});
