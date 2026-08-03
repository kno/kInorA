import { describe, it, expect, vi } from "vitest";
import { resolveAuthorizedOwner, ForbiddenOwnerAccess } from "../owner-access.js";
import type { EntitlementContext } from "../../billing/entitlement.js";
import type { TrainerClientAssignmentDTO } from "@kinora/contracts";

/**
 * resolveAuthorizedOwner — the deny-by-default owner resolver
 * (15a-v2-trainer-account-access, Slice 2). This is the highest-risk unit in
 * the change: it is the ONLY place that ever widens a request's effective
 * owner away from the actor. Every test here is a negative/authorization
 * test EXCEPT the final positive case, per the design's ordering
 * (self → role → entitlement → assignment).
 */

const TENANT = "tenant-1" as never;
const ACTOR = "actor-1" as never;
const OTHER_USER = "other-user-1" as never;
const CLIENT_A = "client-a" as never;
const CLIENT_B = "client-b" as never;

function entitlementReader(ctx: Partial<EntitlementContext>) {
  return {
    loadContext: vi.fn().mockResolvedValue({
      membershipStatus: "active",
      billing: null,
      activeOverrideTier: null,
      ...ctx,
    }),
  };
}

function assignmentRepo(row: TrainerClientAssignmentDTO | undefined) {
  return {
    findActiveAssignment: vi.fn().mockResolvedValue(row),
  };
}

function activeAssignment(clientUserId: unknown): TrainerClientAssignmentDTO {
  return {
    id: "assignment-1",
    tenantId: TENANT,
    trainerUserId: ACTOR,
    clientUserId: clientUserId as never,
    status: "active",
  };
}

describe("resolveAuthorizedOwner", () => {
  it("2.1 self path: no requested owner returns the actor's own id", async () => {
    const deps = {
      entitlementReader: entitlementReader({}),
      assignmentRepo: assignmentRepo(undefined),
    };

    const result = await resolveAuthorizedOwner(
      { tenantId: TENANT, actorUserId: ACTOR, role: "member" },
      deps,
    );

    expect(result).toBe(ACTOR);
    // Self path must never touch entitlement or assignment persistence.
    expect(deps.entitlementReader.loadContext).not.toHaveBeenCalled();
    expect(deps.assignmentRepo.findActiveAssignment).not.toHaveBeenCalled();
  });

  it("2.2 a 'member' role requesting another user's id throws ForbiddenOwnerAccess", async () => {
    const deps = {
      entitlementReader: entitlementReader({}),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: ACTOR, role: "member" },
        deps,
        OTHER_USER,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
    // Denied on role alone — never reaches entitlement or assignment checks.
    expect(deps.entitlementReader.loadContext).not.toHaveBeenCalled();
    expect(deps.assignmentRepo.findActiveAssignment).not.toHaveBeenCalled();
  });

  it("2.3 'trainer' role but tier is not 'trainer' (entitlement missing) throws", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "pro", status: "active", source: "stripe", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(activeAssignment(CLIENT_A)),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: ACTOR, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
    // Denied on entitlement — never reaches the assignment check.
    expect(deps.assignmentRepo.findActiveAssignment).not.toHaveBeenCalled();
  });

  it("2.4 'trainer' role + entitled, but no assignment row throws", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: ACTOR, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("2.5 'trainer' role + entitled, assignment revoked (repo returns undefined) throws", async () => {
    // TrainerAssignmentRepository.findActiveAssignment only ever returns a row
    // for status="active" — a revoked assignment is indistinguishable from a
    // missing one at this boundary, and the resolver denies both identically.
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: ACTOR, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("2.5b a trainer with an active assignment to client A cannot resolve client B", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      // Assignment repo is called with clientUserId=CLIENT_B and correctly
      // returns undefined (no active row for that pair) even though CLIENT_A
      // has one — proves the check is per-requested-client, not per-trainer.
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: ACTOR, role: "trainer" },
        deps,
        CLIENT_B,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
    expect(deps.assignmentRepo.findActiveAssignment).toHaveBeenCalledWith(
      TENANT,
      ACTOR,
      CLIENT_B,
    );
  });

  it("2.6 'trainer' role + entitled + active assignment returns the requested owner (positive case)", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      assignmentRepo: assignmentRepo(activeAssignment(CLIENT_A)),
    };

    const result = await resolveAuthorizedOwner(
      { tenantId: TENANT, actorUserId: ACTOR, role: "trainer" },
      deps,
      CLIENT_A,
    );

    expect(result).toBe(CLIENT_A);
    expect(deps.assignmentRepo.findActiveAssignment).toHaveBeenCalledWith(
      TENANT,
      ACTOR,
      CLIENT_A,
    );
  });

  // 16c-v3-b2b-seat-billing Slice F (design "Downgrade / lapse behavior"):
  // "Seat removed (assignment revoked)" locks in that future trainer-mediated
  // generation for that client is denied via this SAME resolver — no new
  // production code, this proves the EXISTING widening-branch behavior is
  // exactly the contract Slice F depends on. `findActiveAssignment` returning
  // undefined for a revoked row (asserted directly in
  // `trainer-assignment.integration.test.ts`) is indistinguishable here from a
  // missing assignment, so the resolver denies identically with the flat
  // `forbidden_owner_access` the route maps to a 403.
  it("16c Slice F: a revoked assignment denies trainer-mediated generation for that client with ForbiddenOwnerAccess (forbidden_owner_access)", async () => {
    const deps = {
      entitlementReader: entitlementReader({
        billing: { tier: "trainer", status: "active", source: "system", trialStartedAt: null, trialEndsAt: null },
      }),
      // Mirrors what a real revoked row produces: findActiveAssignment never
      // returns a "revoked" row, only active ones — so post-revoke it's undefined.
      assignmentRepo: assignmentRepo(undefined),
    };

    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: ACTOR, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow(ForbiddenOwnerAccess);
    await expect(
      resolveAuthorizedOwner(
        { tenantId: TENANT, actorUserId: ACTOR, role: "trainer" },
        deps,
        CLIENT_A,
      ),
    ).rejects.toThrow("forbidden_owner_access");
  });

  it("requesting exactly the actor's own id is always the (unchanged) self path, regardless of role", async () => {
    const deps = {
      entitlementReader: entitlementReader({}),
      assignmentRepo: assignmentRepo(undefined),
    };

    const result = await resolveAuthorizedOwner(
      { tenantId: TENANT, actorUserId: ACTOR, role: "member" },
      deps,
      ACTOR,
    );

    expect(result).toBe(ACTOR);
    expect(deps.entitlementReader.loadContext).not.toHaveBeenCalled();
  });
});
