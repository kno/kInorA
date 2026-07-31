## Exploration: 15a-v2-trainer-account-access (Trainer tier, client assignment, client plan assignment)

### Current State

**Account/auth model** (`apps/api/src/db/schema.ts:56-159`, `apps/api/src/auth/plugin.ts`, `packages/contracts/src/index.ts:391-399,615-622`):
- `users` (schema.ts:153) has no role/tier column — just email, isAdmin (global superadmin flag, unrelated to tenant roles).
- `tenants` (schema.ts:143) is a bare workspace row. One tenant is auto-provisioned per registering user (`apps/api/src/auth/social-wiring.ts:18-21`).
- `memberships` (schema.ts:166-186) is the ONLY role concept today: `(tenantId, userId)` unique, `role: membershipRoleEnum("owner"|"member")` (schema.ts:78-81), `status: "invited"|"active"|"suspended"`. Comment explicitly flags it as "extensible for future roles" — this enum is the natural trainer-role extension point.
- `MembershipRole` contract type mirrors this: `"owner" | "member"` (`packages/contracts/src/index.ts:399`).
- `resolveAuthContextFromToken` (`apps/api/src/auth/plugin.ts:50-79`) resolves `SessionContext { userId, tenantId, sessionId }` and fail-secure re-checks membership `status === "active"` for that tenant — but never reads/attaches `role`. `requireAuth()` (plugin.ts:171-177) is binary; there is no role-based guard anywhere in the API today.
- `TenantQueryContext`/`TenantQueryContextDTO` (`apps/api/src/tenant/tenant-context.ts:11-14`, contracts:391-394) carry `tenantId` + optional `actorUserId` — the intended seam for "acting on behalf of," but unused for that purpose today.

**Multi-tenant scoping — central finding**: every domain repository filters `AND tenantId = ? AND userId = ?` where BOTH values are always the caller's own session identity. Verified directly in `apps/api/src/db/repositories/plan-spec.ts`: `findConfirmedById`, `create`, `updateSpecDaysPerWeek`, `updateSpecIntensityBias` (lines 29-171) all do `eq(planSpecs.tenantId, tenantId) AND eq(planSpecs.userId, userId)`. Same pattern in `workoutPlans`, `workoutSessions`, `planDrafts`, `userMemoryVectors`, `userProfiles`, `userPreferences` (schema.ts:499-948). **No code path today lets one authenticated user read/write another user's rows, even within the same tenant.** `TenantRepository.findMembershipsByTenant` (`apps/api/src/tenant/repositories.ts:46-52`) is the one "list other tenant members" query, used only for membership bookkeeping.

**Billing tiers** (`apps/api/src/db/schema.ts:95-227`, contracts:406-465): `BillingTier = "free" | "pro"` (contracts:406); `tenantBillingStates` is keyed by `tenantId` alone — tier is per-tenant, shared by all members, resolved server-side by `resolveEffectiveTier`, never client-supplied. Membership role and billing tier are already structurally independent tables.

**Plans & ownership**: `planSpecs`/`workoutPlans`/`workoutSessions` (schema.ts:540-658) all carry `tenantId` + `userId`, created exclusively with the caller's own pair — nothing separates "who owns the row" from "who is acting."

**Existing coach/trainer/client concepts**: none found anywhere in `packages/contracts` or `apps/api/src/db/schema.ts`.

### Affected Areas
- `apps/api/src/db/schema.ts` — role/relationship extension or new `trainer_client_assignments` table; every plan/session table's ownership model is challenged.
- `apps/api/src/tenant/tenant-context.ts`, `apps/api/src/tenant/repositories.ts` — natural seam for actor-vs-owner split.
- `apps/api/src/db/repositories/plan-spec.ts`, `workout-plan.ts`, `workout-session.ts` — every `(tenantId, userId)` signature conflates actor/owner.
- `apps/api/src/auth/plugin.ts` — `SessionContext` has no `role`; needs a role-aware guard.
- `apps/api/src/db/schema.ts:95-227` (`tenantBillingStates`) — decide if Trainer is a tier, a role, or both.
- `packages/contracts/src/index.ts:399,406` (`MembershipRole`, `BillingTier`) — compile-time gates for web/mobile.
- `apps/web`/`apps/mobile` — no existing client-list/plan-for-another-user UI; net-new surface.

### Approaches

1. **Trainer as new `memberships.role` value + `trainer_client_assignments` table, orthogonal to billing** — same-tenant membership extension, repositories gain explicit actor-vs-owner split. Pros: keeps billing/role independent as today; smallest new schema surface; auditable. Cons: moderately wide security-sensitive refactor across repositories/routes. Effort: High.

2. **Trainer as a new `BillingTier` value, cross-tenant client links** — reuses 11a/11b entitlement machinery, but requires an entirely new cross-tenant access primitive since clients keep independent tenants. Effort: High-to-Very High, and materially riskier against the just-hardened tenant-isolation invariant (01c/05b).

3. **Hybrid — role (who can act) + billing gate (entitlement), clients become members of the trainer's tenant** — combines 1's same-tenant assignment with reuse of the proven billing-gate seam; avoids inventing a new cross-tenant primitive. Cons: clients lose independent tenant identity unless a dual-membership story is designed. Effort: High.

4. **Cross-tenant "grant" table + dedicated trainer service that impersonates the client's exact (tenantId, userId) after a grant check, leaving existing repository signatures untouched** — smaller diff, but still needs the hard cross-tenant answer from option 2, and introduces a novel impersonation-shaped code path needing careful review. Effort: Medium-High.

### Recommendation

Approach 3 (hybrid: same-tenant role + assignment + billing-tier gate). It changes the least about the recently-hardened tenant-isolation invariant (01c/05b) — no new cross-tenant primitive — while reusing 11a/11b's proven entitlement gate. The actor-vs-owner repository split is unavoidable in every approach; this one pays that cost with the smallest total blast radius.

### Risks
- Security-critical refactor: any "actor may differ from owner" change directly touches what 05b's fail-secure checks were built to prevent being done carelessly.
- Product ambiguity: do clients stay in their own tenant (needs new cross-tenant model) or join the trainer's tenant (fits current invariant, loses independence)? Spec text ("within the active tenant") leans same-tenant but needs explicit confirmation.
- Billing interaction undefined: Trainer as `MembershipRole`, `BillingTier`, or both — Requirement 1's title is ambiguous.
- No existing trainer/client vocabulary anywhere — greenfield, higher estimate uncertainty.
- Onboarding/assignment UX undefined (spec only covers "Register as Trainer," not invite/assign flow).

### Ready for Proposal

No — three product/scope questions must be resolved with the user before sdd-propose:
1. Is Trainer a `MembershipRole` value, a `BillingTier` value, or both?
2. Do clients stay in their own tenant, or join the trainer's tenant?
3. Can a trainer add any existing user as a client or only newly invited ones, and can a client have multiple trainers?
