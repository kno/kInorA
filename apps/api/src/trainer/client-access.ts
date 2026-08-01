import type { TenantId, UserId } from "@kinora/contracts";
import type { TrainerAssignmentRepository } from "../db/repositories/trainer-assignment.js";
import { ForbiddenOwnerAccess } from "./owner-access.js";

/**
 * Actor identity for a client→trainer-tenant read authorization decision
 * (15b-v2-trainer-dashboard-branding, Phase S2, resolving #283). Deliberately
 * minimal — `resolveClientTrainerTenant` needs only the caller's own id; the
 * tenant it may read from is never supplied by the caller, only resolved
 * from the caller's assignment row.
 */
export interface ActorClientContext {
  actorUserId: UserId;
}

/**
 * Dependencies `resolveClientTrainerTenant` needs. `Pick`-typed so callers
 * can pass the real repository directly and tests can pass a minimal fake.
 */
export interface ClientAccessDeps {
  assignmentRepo: Pick<TrainerAssignmentRepository, "findByClientUserId">;
}

/**
 * Deny-by-default client→trainer-tenant read authorization primitive
 * (design.md "#283 client→trainer-tenant read (highest risk) — dedicated
 * primitive, NOT login switch"). This is the ONLY place that ever lets a
 * CLIENT cross from their own membership tenant into an assigned TRAINER's
 * tenant to read data — and it may only ever resolve reads keyed to the
 * client's OWN `userId`, never any other user's.
 *
 * Deliberately NOT symmetric to `resolveAuthorizedOwner`: that function
 * widens a TRAINER into a CLIENT's owner-id within the TRAINER's own tenant.
 * This function does the opposite shape — it lets a CLIENT read within a
 * DIFFERENT tenant (the trainer's), but the `userId` filter downstream is
 * ALWAYS the client's own `ctx.actorUserId` and is never widened to any
 * other user's id. The two functions solve different problems and must not
 * be merged or have one call the other.
 *
 * Resolution:
 *   1. Look up the caller's single non-revoked assignment via
 *      `assignmentRepo.findByClientUserId(ctx.actorUserId)`.
 *   2. Deny (`ForbiddenOwnerAccess`) unless a row exists with
 *      `status === "active"` AND `clientUserId === ctx.actorUserId` (the
 *      second check is defence-in-depth against a hypothetical repo bug
 *      that returns a mismatched row — the resolver never trusts a row's
 *      tenantId without first confirming the row is actually the caller's
 *      own).
 *   3. Otherwise return that row's trainer `tenantId` — this is the ONLY
 *      tenant a caller can ever resolve, because
 *      `trainer_client_assignments` enforces at most one non-revoked
 *      assignment per client (see `TrainerAssignmentRepository.create`'s
 *      partial unique index doc comment).
 *
 * Any unhandled/unexpected case denies — this function has no fallback
 * "allow" branch. It does not touch login, session establishment, or
 * `selectActiveTenant`, which stays unwired (design.md "Self-only-unchanged
 * proof").
 */
export async function resolveClientTrainerTenant(
  ctx: ActorClientContext,
  deps: ClientAccessDeps,
): Promise<TenantId> {
  const assignment = await deps.assignmentRepo.findByClientUserId(ctx.actorUserId);

  if (
    !assignment ||
    assignment.status !== "active" ||
    assignment.clientUserId !== ctx.actorUserId
  ) {
    throw new ForbiddenOwnerAccess();
  }

  return assignment.tenantId;
}
