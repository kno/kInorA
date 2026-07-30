import { describe, it, expect } from "vitest";
import { resolveAuthorizedOwner, ForbiddenOwnerAccess } from "../owner-access.js";
import type { EntitlementContext } from "../../billing/entitlement.js";
import type { TrainerClientAssignmentDTO } from "@kinora/contracts";

/**
 * Regression guard (15a-v2-trainer-account-access, task 2.12) — assignment-
 * check omission guard.
 *
 * Intent: no trainer-scoped route may EVER read/write another user's owned
 * data without first routing the requested owner through
 * `resolveAuthorizedOwner`. In Slice 2 there is NO trainer-scoped route yet
 * (S3 adds invite/list, S4 adds client-owned plan creation) — this file exists
 * NOW, before those routes, so the security seam is reviewed and the guard
 * mechanism proven BEFORE anything it is meant to police is built.
 *
 * Per the S2 correction to the original plan: this slice must ship with a
 * GREEN suite. The guard therefore does two things instead of asserting a
 * currently-nonexistent route wiring:
 *   1. Enumerates `TRAINER_SCOPED_ROUTES` (below) — currently empty — as the
 *      single source of truth S3 (task 3.8) and S4 (task 4.5) extend when
 *      each new trainer-scoped route lands. `it.each` over an empty array
 *      produces zero test cases, which is a legitimate pass, not a skip.
 *   2. Asserts the resolver's OWN deny-by-default invariants directly, since
 *      those are exactly what any future route-level probe must observe:
 *      self-only for non-trainer roles, and role+entitlement+active-assignment
 *      all required for a trainer to widen to a client.
 */

// TODO(S3 task 3.8): add `{ method: "POST", path: "/trainer/clients/invite" }`,
//   `{ method: "GET", path: "/trainer/clients" }` once routes/trainer.ts lands.
// TODO(S4 task 4.5): add `{ method: "POST", path: "/clients/:clientUserId/plan-specs" }`
//   once routes/plan.ts threads ownerUserId through resolveAuthorizedOwner.
const TRAINER_SCOPED_ROUTES: ReadonlyArray<{ method: string; path: string }> = [];

const TENANT = "tenant-1" as never;
const TRAINER = "trainer-1" as never;
const MEMBER = "member-1" as never;
const OTHER_USER = "other-user-1" as never;
const CLIENT_A = "client-a" as never;
const CLIENT_B = "client-b" as never;

function entitlementReader(ctx: Partial<EntitlementContext>) {
  return {
    loadContext: async () => ({
      membershipStatus: "active" as const,
      billing: null,
      activeOverrideTier: null,
      ...ctx,
    }),
  };
}

function assignmentRepo(row: TrainerClientAssignmentDTO | undefined) {
  return { findActiveAssignment: async () => row };
}

describe("regression guard: trainer-scoped routes must resolve ownership via resolveAuthorizedOwner", () => {
  it("enumerates the current (possibly empty) set of trainer-scoped routes — extend in S3/S4", () => {
    expect(TRAINER_SCOPED_ROUTES).toEqual([]);
  });

  it.each(TRAINER_SCOPED_ROUTES)(
    "$method $path resolves ownership via resolveAuthorizedOwner before any repo call",
    () => {
      // Placeholder for a future route-level probe (spy on resolveAuthorizedOwner
      // + assert it is called before any repository method on the route's
      // handler). No entries exist in Slice 2, so this never actually runs —
      // it is here so adding an entry to TRAINER_SCOPED_ROUTES immediately
      // creates a case that must be filled in, rather than being silently
      // uncovered.
      expect.fail("wire a route-level resolveAuthorizedOwner probe for this route");
    },
  );

  // --- Resolver invariants the guard exists to police ---

  it("self-only default is provably unchanged: a non-trainer role can never widen", async () => {
    const deps = {
      entitlementReader: entitlementReader({}),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: MEMBER, role: "member" },
        deps,
        OTHER_USER,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);

    const self = await resolveAuthorizedOwner(
      { tenantId: TENANT, actorUserId: MEMBER, role: "member" },
      deps,
    );
    expect(self).toBe(MEMBER);
  });

  it("a trainer without the trainer entitlement is denied even with the trainer role", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "pro", status: "active", source: "stripe", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo({
        id: "a1",
        tenantId: TENANT,
        trainerUserId: TRAINER,
        clientUserId: CLIENT_A,
        status: "active",
      }),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("a trainer with role+entitlement but no active assignment for the client is denied", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("a trainer assigned to client A cannot resolve client B", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
        deps,
        CLIENT_B,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("a trainer with role+entitlement+active assignment resolves the client (positive case)", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo({
        id: "a1",
        tenantId: TENANT,
        trainerUserId: TRAINER,
        clientUserId: CLIENT_A,
        status: "active",
      }),
    };

    const ownerId = await resolveAuthorizedOwner(
      { tenantId: TENANT, actorUserId: TRAINER, role: "trainer" },
      deps,
      CLIENT_A,
    );
    expect(ownerId).toBe(CLIENT_A);
  });
});
