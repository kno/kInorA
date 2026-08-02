import { describe, it, expect, vi } from "vitest";
import { assertGymEntitled, ForbiddenGymAccess } from "../gym-access.js";

/**
 * `assertGymEntitled` unit tests (16a-v3-gym-white-label, Slice 2 — pulled
 * forward from tasks.md's Phase 3 (S3) task 3.1 because the merge-safety
 * requirement for Slice 2's `POST /branding/logo` route mandates real
 * gym-tier gating from the start, not an ungated upload endpoint. Phase 3
 * (S3) reuses this SAME helper for the branding CRUD routes and tenant-
 * isolation tests — no re-implementation needed there.
 *
 * Mirrors `assertTrainerEntitled` (trainer/owner-access.ts) but is tier-only:
 * there is no `"gym"` value in `MembershipRole` (owner|member|trainer), so
 * gating is purely the resolved billing tier, not the caller's role.
 */
function entitlementReader(tier: "free" | "pro" | "trainer" | "gym") {
  return {
    loadContext: vi.fn().mockResolvedValue({
      membershipStatus: "active",
      billing: { tier, status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      activeOverrideTier: null,
    }),
  };
}

const TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

describe("assertGymEntitled", () => {
  it("throws ForbiddenGymAccess when the resolved tier is not gym", async () => {
    const deps = { entitlementReader: entitlementReader("pro") };

    await expect(
      assertGymEntitled({ tenantId: TENANT_ID, actorUserId: USER_ID }, deps),
    ).rejects.toThrow(ForbiddenGymAccess);
  });

  it("throws for free tier", async () => {
    const deps = { entitlementReader: entitlementReader("free") };

    await expect(
      assertGymEntitled({ tenantId: TENANT_ID, actorUserId: USER_ID }, deps),
    ).rejects.toThrow(ForbiddenGymAccess);
  });

  it("resolves without throwing when the resolved tier is gym", async () => {
    const deps = { entitlementReader: entitlementReader("gym") };

    await expect(
      assertGymEntitled({ tenantId: TENANT_ID, actorUserId: USER_ID }, deps),
    ).resolves.toBeUndefined();
  });
});
