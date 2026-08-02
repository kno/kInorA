import type { TenantId, UserId } from "@kinora/contracts";
import type { EntitlementReaderPort } from "./entitlement.js";
import { resolveEffectiveTier } from "./entitlement.js";

/**
 * Gym-tier gating (16a-v3-gym-white-label). Mirrors
 * `assertTrainerEntitled` (trainer/owner-access.ts) — same fail-closed shape,
 * same single denial error type — but is TIER-ONLY: there is no `"gym"`
 * value in `MembershipRole` (`"owner" | "member" | "trainer"`), so gating a
 * gym branding action never checks the caller's role, only the tenant's
 * resolved billing tier.
 *
 * Used by `POST /branding/logo` (Slice 2) and reused unchanged by the
 * branding CRUD routes + public read-by-slug gating tests (Slice 3).
 */

/** Actor identity scoped to the tenant the request is bound to. */
export interface GymAccessContext {
  tenantId: TenantId | string;
  actorUserId: UserId | string;
}

/**
 * Thrown for the single denial path: the tenant's resolved billing tier is
 * not `"gym"`. Callers translate this to a flat 403 (never leaking WHICH
 * specific billing state produced the denial to an unauthorized caller).
 */
export class ForbiddenGymAccess extends Error {
  constructor(message = "forbidden_gym_access") {
    super(message);
    this.name = "ForbiddenGymAccess";
  }
}

export interface GymAccessDeps {
  entitlementReader: Pick<EntitlementReaderPort, "loadContext">;
}

/**
 * Deny-by-default gym-tier gate. Resolves the tenant's effective billing
 * tier (via the SAME `resolveEffectiveTier` every other billing decision in
 * this codebase uses) and throws `ForbiddenGymAccess` unless it is exactly
 * `"gym"`.
 */
export async function assertGymEntitled(
  ctx: GymAccessContext,
  deps: GymAccessDeps,
): Promise<void> {
  const entitlementCtx = await deps.entitlementReader.loadContext({
    tenantId: ctx.tenantId as string,
    userId: ctx.actorUserId as string,
  });
  const effective = resolveEffectiveTier(entitlementCtx, new Date());
  if (effective.tier !== "gym") {
    throw new ForbiddenGymAccess();
  }
}
