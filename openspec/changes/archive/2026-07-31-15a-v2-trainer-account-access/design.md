# Design: Trainer Account Access (v2)

## Technical Approach

Exploration Approach 3 (hybrid). `trainer` is a new `memberships.role` (who may act) gated by a new `BillingTier` value `trainer` (may they), reusing the 11a `resolveEffectiveTier` seam. Clients become members of the trainer's tenant (dual membership, no cross-tenant primitive). A new `trainer_client_assignments` table records the auditable link and enforces one-trainer-per-client. The security core is an **actor-vs-owner resolver** at the route/service boundary: repositories stay `(tenantId, userId)`-filtered exactly as today; the only change is WHO computes the `ownerUserId` handed to them. Normal users resolve to self (unchanged 05b path); a trainer widens to a client only after role + entitlement + active-assignment all pass.

## Architecture Decisions

### Decision: Owner resolution lives in a dedicated resolver, not in repositories
**Choice**: New `resolveAuthorizedOwner(ctx, requestedOwnerUserId?)` in `apps/api/src/trainer/owner-access.ts`, called at the route layer before any repo call. Repos keep their current `(tenantId, userId)` WHERE clauses verbatim; `userId` is renamed semantically to `ownerUserId` but the filter is byte-identical.
**Alternatives considered**: (a) assignment check inside each repository method — spreads the security check across ~8 methods, high omission risk; (b) impersonation service that swaps the whole session identity — novel, hard-to-review, contradicts same-tenant.
**Rationale**: Single choke point = deny-by-default and provable. Repos never receive an unauthorized owner, so the existing fail-secure filter (05b) keeps protecting every path unchanged. A normal `member` request carries no client param → resolver returns self; only the trainer branch can widen.

Resolver logic (deny-by-default):
```
resolveAuthorizedOwner(ctx: ActorOwnerContext, requested?: UserId): UserId
  if !requested || requested === ctx.actorUserId  → return ctx.actorUserId   // self path (all normal users)
  // widening branch — ALL must hold, else throw ForbiddenOwnerAccess:
  assert ctx.role === "trainer"
  assert (await resolveEffectiveTier(scope)).tier === "trainer"              // entitlement gate
  assert active row in trainer_client_assignments (tenantId, trainerUserId=actor, clientUserId=requested, status="active")
  return requested
```
A `member` can never satisfy the branch → provably self-only. Concrete path — `POST /clients/:clientUserId/plan-specs`: route derives `ActorOwnerContext` from `authContext`, calls resolver with `:clientUserId`, then `specRepo.create(trainerTenantId, ownerUserId, spec)`.

### Decision: `SessionContext` gains `role`; both role AND `trainer` tier gate the capability
**Choice**: Extend `findByTenantAndUser` (already re-read fail-secure in `resolveAuthContextFromToken`) to return `role`; attach `role` to `SessionContext`. Add `requireRole("trainer")` preHandler for trainer-only routes; the resolver additionally enforces the entitlement (`tier === "trainer"`). Both role and tier must pass.
**Rationale**: Zero extra query — the membership row is already fetched fail-secure. Role and billing stay independent tables (no coupling drift).

### Decision: Dual membership; trainer-built training data scoped to the trainer's tenant
**Choice**: The client keeps their personal tenant and gains a second `memberships` row in the trainer's tenant. Trainer-created `planSpecs`/`workoutPlans`/`workoutSessions` are written with `tenantId = trainerTenant, userId = client`. The client sees/executes them when their active session is scoped to the trainer's tenant (session issuance must pick among active memberships).
**Alternatives considered**: migrate the client into the trainer's tenant (destructive, loses personal data independence); write training data into the client's personal tenant (needs a cross-tenant primitive — rejected by scope).
**Rationale**: Additive and reversible; personal-tenant data (billing, auth, vector memory, unrelated profile) stays in the personal tenant and is **unreachable** by the trainer → minimum-necessary access. Only the four training tables in the trainer's tenant are shared.

### Decision: minimum-necessary trainer-accessible set
Trainer may act (via resolver) ONLY on the assigned client's rows in: `plan_specs`, `workout_plans`, `workout_sessions`/`session_exercises`, and the training-relevant `user_profiles`/`user_preferences` fields used to build a plan. **Excluded**: `tenant_billing_states`, `sessions`, `oauth_accounts`, `passwords`, `user_memory_vectors` (personal-tenant scoped, never resolved for a trainer).

## Data Flow
```
Trainer request (:clientUserId) → requireAuth → requireRole(trainer)
    → resolveAuthorizedOwner(role+tier+assignment) ──deny──▶ 403
                    │ ownerUserId
                    ▼
   PlanSpecRepository.create(trainerTenantId, ownerUserId, spec)   [filter unchanged]
                    ▼
   generation-service.startGeneration(trainerTenantId, ownerUserId, specId)
Normal user request (no client param) → resolveAuthorizedOwner → self → identical to today
```

## File Changes
| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modify | `trainer` in `membershipRoleEnum` + `billingTierEnum`; new `trainerAssignmentStatusEnum`; new `trainer_client_assignments` table + partial unique index |
| `apps/api/src/trainer/owner-access.ts` | Create | `ActorOwnerContext`, `resolveAuthorizedOwner`, `ForbiddenOwnerAccess` |
| `apps/api/src/db/repositories/trainer-assignment.ts` | Create | assignment CRUD + active-assignment check |
| `apps/api/src/auth/plugin.ts` | Modify | attach `role` to `SessionContext`; `requireRole()` guard |
| `apps/api/src/db/repositories/auth-context.ts` | Modify | `findByTenantAndUser` returns `role` |
| `apps/api/src/billing/plan-limits.ts` | Modify | `TRAINER_TIER_LIMITS` (≥ pro) so `trainer` tier is not silently Free |
| `apps/api/src/routes/trainer.ts` | Create | invite client, list clients, create-plan-for-client routes |
| `apps/api/src/routes/plan.ts`, `ai/generation-service.ts` | Modify | thread resolved `ownerUserId` |
| `apps/api/src/auth/social.ts` / session issuance | Modify | choose active tenant among memberships |
| `packages/contracts/src/index.ts` | Modify | `MembershipRole`+='trainer'; `BillingTier`+='trainer'; `SessionContext.role`; assignment DTOs |
| `apps/web`, `apps/mobile` | Create | client list + create-plan-for-client surfaces |

## Interfaces / Contracts
```typescript
export type MembershipRole = "owner" | "member" | "trainer";
export type BillingTier = "free" | "pro" | "trainer";
export interface SessionContext { userId: UserId; tenantId: TenantId; sessionId: SessionId; role: MembershipRole; }
export interface ActorOwnerContextDTO { tenantId: TenantId; actorUserId: UserId; role: MembershipRole; }
export type TrainerAssignmentStatus = "invited" | "active" | "revoked";
export interface TrainerClientAssignmentDTO { id: string; tenantId: TenantId; trainerUserId: UserId; clientUserId: UserId; status: TrainerAssignmentStatus; }
export interface InviteClientRequest { email: string; }
export interface ClientSummaryDTO { clientUserId: UserId; email: string; status: TrainerAssignmentStatus; }
```
`trainer_client_assignments`: `id, tenant_id→tenants, trainer_user_id→users, client_user_id→users, status, created_at, updated_at`; **one-trainer-per-client** = partial unique index on `(client_user_id) WHERE status <> 'revoked'`; also `unique(tenant_id, client_user_id)`.

## Testing Strategy
| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `resolveAuthorizedOwner` truth table | self→self; `member` requesting other→throw; trainer no entitlement→throw; trainer entitled + no/revoked assignment→throw; trainer+active assignment→ownerUserId |
| Unit | `resolveTenantFeatureLimit("trainer",...)` | trainer tier not silently Free |
| Integration | repo isolation intact | non-trainer request for another user's `plan_spec`/`workout_plan` still returns undefined; one-trainer-per-client unique violation raises |
| Integration | trainer paths | trainer creates spec owned by client; trainer denied on **non-assigned** client (403) |
| Regression | assignment-check omission guard | test enumerates trainer-scoped routes and asserts each routes through `resolveAuthorizedOwner` |
| E2E | invite→accept→create→visibility | client sees only own plans; trainer sees only assigned clients |

## Threat Matrix
N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (Authorization risk is covered above and by the negative-auth tests.)

## Migration / Rollout
Migration REQUIRED (additive): `ALTER TYPE membership_role ADD VALUE 'trainer'`; `ALTER TYPE billing_tier ADD VALUE 'trainer'`; new `trainer_assignment_status` enum; `CREATE TABLE trainer_client_assignments` + indexes. Gotcha: Postgres `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that also references the new value — split enum-add and table/usage into separate migration steps. Feature-flag trainer registration + `requireRole`. Rollback per slice: drop table, drop enum values (additive); resolver's self path preserves normal-user behavior on revert.

## Slice Plan (chained PRs — 400-line budget risk: High)
1. **Schema + contracts + entitlement**: enum values, `trainer_client_assignments`, `SessionContext.role`, `TRAINER_TIER_LIMITS`. No behavior change.
2. **Authorization seam**: `ActorOwnerContext` + `resolveAuthorizedOwner` + assignment repo + full negative-auth suite. Self path provably unchanged. Heavily reviewed.
3. **Invite/assignment flow**: invite-by-email, membership `invited→active`, assignment lifecycle, list-clients.
4. **Client-owned plan creation**: trainer routes threading `ownerUserId` through generation + quota metered to trainer tenant.
5. **Web + mobile surfaces**: client list, create-plan-for-client.

## Open Questions
- [x] Client visibility of trainer-built plans requires the client's session to be scoped to the trainer's tenant — the active-tenant selection at login/switch is the minimal enabler; confirm its UX is acceptable for v1 (else defer client-facing view to a follow-up). **Resolved (archive-time): deferred.** S3 shipped the minimal enabler (`selectActiveTenant`, `findActiveMemberships`) unwired from the default login path; the dedicated client-facing view of trainer-built plans (task 5.8) is explicitly deferred to a follow-up change pending an explicit active-tenant-selection UX decision.

## Archive Note (2026-07-31)

Shipped as designed across 5 slices (PRs #277-#281). No architectural deviations from this design except the documented S5 create-plan-for-client form (see tasks.md 5.3) and the deferred 5.8 item above.
