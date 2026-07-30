/**
 * Active-tenant selection (15a-v2-trainer-account-access, Slice 3, task 3.7
 * — "the minimal enabler so a client/trainer session CAN act in the
 * trainer's tenant").
 *
 * Once a client accepts a trainer's invite (`POST /trainer/clients/accept`)
 * they have TWO active `memberships` rows: their personal tenant (created at
 * sign-up) and the trainer's tenant (created by the invite). This is a pure,
 * deterministic primitive for choosing which tenant a session should be
 * scoped to, GIVEN the full list of the user's active memberships
 * (`MembershipRepository.findActiveMemberships`, added this slice).
 *
 * Deliberately NOT wired into the default login path in this slice: the
 * client-facing view of trainer-built plans (the ONLY feature that needs a
 * client to explicitly act in the trainer's tenant) is EXPLICITLY deferred to
 * a follow-up (spec: "Deferred — Client-Facing View of Trainer-Built Plans").
 * Wiring this into `auth/social.ts`/`auth/service.ts` login resolution today
 * would change production sign-in behavior for a feature this slice does not
 * yet expose, so it stays an isolated, unit-tested capability ready for that
 * follow-up to consume. Existing single-membership login is completely
 * unaffected (the "no preference" path — the default — always returns the
 * first membership, exactly like `MembershipRepository.findActiveByUserId`'s
 * current `rows[0]` behavior).
 */
export function selectActiveTenant<T extends { tenantId: string }>(
  activeMemberships: readonly T[],
  preferredTenantId?: string,
): T | null {
  if (activeMemberships.length === 0) {
    return null;
  }

  if (preferredTenantId) {
    const preferred = activeMemberships.find((m) => m.tenantId === preferredTenantId);
    if (preferred) {
      return preferred;
    }
  }

  return activeMemberships[0]!;
}
