import { describe, it, expect, vi } from "vitest";
import { resolveClientTrainerTenant } from "../client-access.js";
import { ForbiddenOwnerAccess } from "../owner-access.js";
import type { TrainerClientAssignmentDTO } from "@kinora/contracts";

/**
 * resolveClientTrainerTenant — the #283 deny-by-default client→trainer-tenant
 * read primitive (15b-v2-trainer-dashboard-branding, Phase S2). This is the
 * highest-risk unit in the change: it is the ONLY place that ever lets a
 * CLIENT cross into a trainer's tenant, and it may only ever resolve reads
 * keyed to the client's OWN `userId`. Every test here is a negative/
 * authorization test EXCEPT the final positive case.
 */

const TRAINER_T = "trainer-t" as never;
const TRAINER_U = "trainer-u" as never;
const TENANT_T = "tenant-t" as never;
const TENANT_U = "tenant-u" as never;
const CLIENT_A = "client-a" as never;
const CLIENT_B = "client-b" as never;

function assignmentRepo(row: TrainerClientAssignmentDTO | undefined) {
  return {
    findByClientUserId: vi.fn().mockResolvedValue(row),
  };
}

function activeAssignment(
  clientUserId: unknown,
  tenantId: unknown = TENANT_T,
  trainerUserId: unknown = TRAINER_T,
): TrainerClientAssignmentDTO {
  return {
    id: "assignment-1",
    tenantId: tenantId as never,
    trainerUserId: trainerUserId as never,
    clientUserId: clientUserId as never,
    status: "active",
  };
}

describe("resolveClientTrainerTenant", () => {
  it("2.1 no assignment row for the caller throws ForbiddenOwnerAccess, no repo call beyond the lookup", async () => {
    const deps = { assignmentRepo: assignmentRepo(undefined) };

    await expect(
      resolveClientTrainerTenant({ actorUserId: CLIENT_A }, deps),
    ).rejects.toThrow(ForbiddenOwnerAccess);
    expect(deps.assignmentRepo.findByClientUserId).toHaveBeenCalledWith(CLIENT_A);
    expect(deps.assignmentRepo.findByClientUserId).toHaveBeenCalledTimes(1);
  });

  it("2.1 a revoked assignment row throws ForbiddenOwnerAccess", async () => {
    const revoked: TrainerClientAssignmentDTO = {
      ...activeAssignment(CLIENT_A),
      status: "revoked",
    };
    const deps = { assignmentRepo: assignmentRepo(revoked) };

    await expect(
      resolveClientTrainerTenant({ actorUserId: CLIENT_A }, deps),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("2.1 a merely-invited (not yet accepted) assignment row throws ForbiddenOwnerAccess", async () => {
    const invited: TrainerClientAssignmentDTO = {
      ...activeAssignment(CLIENT_A),
      status: "invited",
    };
    const deps = { assignmentRepo: assignmentRepo(invited) };

    await expect(
      resolveClientTrainerTenant({ actorUserId: CLIENT_A }, deps),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("2.2 client A's own lookup can never resolve client B's assignment — the repo is always queried by the caller's own id", async () => {
    // The repository call is always keyed to ctx.actorUserId (A) — there is no
    // parameter through which a caller could ever request B's row.
    const deps = { assignmentRepo: assignmentRepo(activeAssignment(CLIENT_A)) };

    const result = await resolveClientTrainerTenant({ actorUserId: CLIENT_A }, deps);

    expect(result).toBe(TENANT_T);
    expect(deps.assignmentRepo.findByClientUserId).toHaveBeenCalledWith(CLIENT_A);
    expect(deps.assignmentRepo.findByClientUserId).not.toHaveBeenCalledWith(CLIENT_B);
  });

  it("2.2 defence-in-depth: a returned row whose clientUserId does not match the actor is denied rather than trusted", async () => {
    // Guards against a hypothetical repo bug/misuse that returns someone
    // else's row — the resolver re-checks clientUserId === ctx.actorUserId
    // before ever trusting the row's tenantId.
    const mismatched = activeAssignment(CLIENT_B);
    const deps = { assignmentRepo: assignmentRepo(mismatched) };

    await expect(
      resolveClientTrainerTenant({ actorUserId: CLIENT_A }, deps),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("2.3 a client assigned only to trainer T resolves ONLY T's tenantId — trainer U's tenant is unreachable", async () => {
    const deps = { assignmentRepo: assignmentRepo(activeAssignment(CLIENT_A, TENANT_T, TRAINER_T)) };

    const result = await resolveClientTrainerTenant({ actorUserId: CLIENT_A }, deps);

    expect(result).toBe(TENANT_T);
    expect(result).not.toBe(TENANT_U);
  });

  it("2.4 an ordinary user with no trainer/client relationship is denied", async () => {
    const deps = { assignmentRepo: assignmentRepo(undefined) };

    await expect(
      resolveClientTrainerTenant({ actorUserId: "ordinary-user" as never }, deps),
    ).rejects.toThrow(ForbiddenOwnerAccess);
  });

  it("2.6 happy path: an active assignment resolves the trainer's tenantId", async () => {
    const deps = { assignmentRepo: assignmentRepo(activeAssignment(CLIENT_A, TENANT_T, TRAINER_U)) };

    const result = await resolveClientTrainerTenant({ actorUserId: CLIENT_A }, deps);

    expect(result).toBe(TENANT_T);
    expect(deps.assignmentRepo.findByClientUserId).toHaveBeenCalledWith(CLIENT_A);
  });
});
