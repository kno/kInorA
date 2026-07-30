import type { MembershipRole, TenantId, UserId } from "@kinora/contracts";
import type { EntitlementReaderPort } from "../billing/entitlement.js";
import { resolveEffectiveTier } from "../billing/entitlement.js";
import type { TrainerAssignmentRepository } from "../db/repositories/trainer-assignment.js";

/**
 * Actor identity + role for a single authorization decision, scoped to the
 * tenant the request is bound to (15a-v2-trainer-account-access, Slice 2).
 * Deliberately narrower than `SessionContext` — `resolveAuthorizedOwner` only
 * needs these three fields, so callers/tests never have to construct a full
 * session just to authorize an owner lookup.
 */
export interface ActorOwnerContext {
  tenantId: TenantId;
  actorUserId: UserId;
  role: MembershipRole;
}

/**
 * Thrown by `resolveAuthorizedOwner` for EVERY denial path (missing role,
 * missing entitlement, missing/revoked assignment, or any other unhandled
 * case). A single error type keeps the security boundary provable: callers
 * translate it to a flat 403 without leaking WHICH specific check failed to
 * an unauthorized caller, and no denial path can accidentally widen access
 * by falling through to a different, more permissive branch.
 */
export class ForbiddenOwnerAccess extends Error {
  constructor(message = "forbidden_owner_access") {
    super(message);
    this.name = "ForbiddenOwnerAccess";
  }
}

/**
 * Dependencies `resolveAuthorizedOwner` needs to check the widening branch.
 * `Pick`-typed so callers can pass the real repositories/adapters directly
 * without an adapter shim, and tests can pass minimal fakes.
 */
export interface OwnerAccessDeps {
  entitlementReader: Pick<EntitlementReaderPort, "loadContext">;
  assignmentRepo: Pick<TrainerAssignmentRepository, "findActiveAssignment">;
}

/**
 * Deny-by-default owner resolver — the SINGLE choke point that decides which
 * `ownerUserId` a route is allowed to hand to a repository (design.md
 * "Owner resolution lives in a dedicated resolver, not in repositories").
 * Repositories keep their current `(tenantId, userId)` filters byte-identical;
 * this function is the only thing that ever chooses to widen `userId` away
 * from the actor.
 *
 * Self path (unchanged 05b behavior): no `requestedOwnerUserId`, or it equals
 * the actor's own id → returns the actor's id. This is the ONLY path a
 * non-trainer role (e.g. `member`) can ever take — it can never reach the
 * widening branch below, because that branch is only entered when a
 * DIFFERENT owner is requested, and it unconditionally asserts
 * `role === "trainer"` first.
 *
 * Widening branch — ALL of the following must hold, checked in ascending
 * cost order (in-memory role check → one entitlement query → one assignment
 * query), else throws `ForbiddenOwnerAccess`:
 *   1. `ctx.role === "trainer"`
 *   2. the actor's resolved billing tier (via `resolveEffectiveTier`) is
 *      exactly `"trainer"` (role alone is not enough — the capability is
 *      ALSO gated by entitlement)
 *   3. an ACTIVE row exists in `trainer_client_assignments` for
 *      `(tenantId, trainerUserId=actor, clientUserId=requested)`
 *      (`TrainerAssignmentRepository.findActiveAssignment` only ever returns
 *      a row for `status="active"` — a missing OR revoked assignment is
 *      indistinguishable at this boundary and denies identically)
 *
 * Any unhandled/unexpected case denies — this function has no fallback
 * "allow" branch.
 */
export async function resolveAuthorizedOwner(
  ctx: ActorOwnerContext,
  deps: OwnerAccessDeps,
  requestedOwnerUserId?: UserId,
): Promise<UserId> {
  if (!requestedOwnerUserId || requestedOwnerUserId === ctx.actorUserId) {
    return ctx.actorUserId;
  }

  await assertTrainerEntitled(ctx, deps);

  const assignment = await deps.assignmentRepo.findActiveAssignment(
    ctx.tenantId,
    ctx.actorUserId,
    requestedOwnerUserId,
  );
  if (!assignment) {
    throw new ForbiddenOwnerAccess();
  }

  return requestedOwnerUserId;
}

/**
 * The role+entitlement half of the widening branch above (steps 1-2),
 * extracted so trainer-scoped routes that do NOT resolve a specific client
 * owner — inviting a new client, listing the trainer's own clients
 * (15a-v2-trainer-account-access, Slice 3) — can reuse the EXACT SAME gate
 * `resolveAuthorizedOwner` uses instead of reimplementing the role/tier
 * checks. Any route that DOES resolve ownership over a specific client's data
 * must still go through `resolveAuthorizedOwner` (which calls this
 * internally) — this helper alone never checks assignment and must not be
 * used as a substitute for it.
 *
 * Throws `ForbiddenOwnerAccess` (the SAME error type as the full resolver)
 * when `ctx.role !== "trainer"` or the resolved billing tier is not
 * `"trainer"`.
 */
export async function assertTrainerEntitled(
  ctx: ActorOwnerContext,
  deps: Pick<OwnerAccessDeps, "entitlementReader">,
): Promise<void> {
  if (ctx.role !== "trainer") {
    throw new ForbiddenOwnerAccess();
  }

  const entitlementCtx = await deps.entitlementReader.loadContext({
    tenantId: ctx.tenantId,
    userId: ctx.actorUserId,
  });
  const effective = resolveEffectiveTier(entitlementCtx, new Date());
  if (effective.tier !== "trainer") {
    throw new ForbiddenOwnerAccess();
  }
}
