# Proposal: Trainer Account Access (v2)

## Intent

Let a paying trainer manage a roster of clients inside their own tenant: invite clients, and build/own workout plans on each client's behalf. Today no code path lets one user act on another user's rows — every repository filters `(tenantId, userId)` = the caller's own identity. This is the first v2 feature and introduces the actor-vs-owner distinction the platform lacks.

## Scope

### In Scope
- New `trainer` value in `memberships.role` enum + role-aware auth guard (`SessionContext` gains `role`).
- Trainer capability gated behind a billing entitlement (reuse 11a/11b machinery).
- Same-tenant trainer→client assignment (invited clients, one trainer per client).
- Safe actor-vs-owner split on trainer-scoped plan/session access.
- Trainer client invite/assignment flow; trainer creates PlanSpec/WorkoutPlan OWNED by the client.
- Net-new web + mobile surfaces: client list, create-plan-for-client.

### Out of Scope
- Cross-tenant clients (clients keep their own tenant) — deliberately preserves 01c/05b isolation.
- Multiple trainers per client; assigning arbitrary existing users as clients.
- Trainer dashboard / branded plans (that is 15b).

## Capabilities

### New Capabilities
- `15a-v2-trainer-account-access`: trainer role, client assignment, client-owned plan creation, and the actor-vs-owner authorization model.

### Modified Capabilities
- `05b-v1-security-tenant-validation`: fail-secure ownership checks must now permit an assigned trainer to act on a client's rows without weakening the default self-only path.
- `11a-v1-billing-plans-tiers`: trainer capability becomes a gated entitlement.

## Approach

Exploration Approach 3 (hybrid). `trainer` is a membership role (who may act) gated by a billing entitlement (may they). Clients become members of the trainer's tenant — no new cross-tenant primitive. Add a `trainer_client_assignments` table (explicit, auditable, enforces one-trainer-per-client via unique client key) rather than overloading membership columns. Every trainer-scoped repository access resolves an authorized owner then verifies the assignment before touching client rows; the normal self-only path is untouched. Large feature — delivery spans multiple chained slices.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modified/New | `trainer` role enum value; new `trainer_client_assignments` table |
| `apps/api/src/auth/plugin.ts` | Modified | `SessionContext.role` + role-aware guard |
| `apps/api/src/tenant/tenant-context.ts`, `tenant/repositories.ts` | Modified | actor-vs-owner seam |
| `apps/api/src/db/repositories/plan-spec.ts`, `workout-plan.ts`, `workout-session.ts` | Modified | authorized-owner + assignment check |
| `packages/contracts/src/index.ts` (`MembershipRole`, billing) | Modified | trainer role/entitlement types |
| `apps/web`, `apps/mobile` | New | client list, create-plan-for-client |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Actor-vs-owner refactor weakens tenant isolation (05b fail-secure) | High | Explicit assignment check on every trainer path; default self-only path unchanged; heavy review |
| Assignment-check omission on a new/edited repo method | Med | Centralize authorized-owner resolution; deny-by-default |
| Billing/role coupling drift | Med | Keep role and entitlement in existing independent tables |
| UI scope creep | Med | Minimal client-list + create-plan surfaces only |

## Rollback Plan

Feature-flag trainer registration + guards. Revert per slice: assignment table is additive (drop table, drop enum value); repository changes preserve self-only behavior so a rollback leaves normal users unaffected.

## Dependencies

- `01c-v1-multi-tenant-schema`, `05b-v1-security-tenant-validation`, `11a-v1-billing-plans-tiers`.

## Open Questions (for design)

- [x] Exact placement of the assignment check (repository vs. service vs. guard layer). — Resolved in design: dedicated resolver (`resolveAuthorizedOwner`) at the route boundary.
- [x] Invite flow mechanics (email invite, invite acceptance, membership status transitions). — Resolved in S3.
- [x] What happens to a client's pre-existing personal tenant/data when they join a trainer's tenant. — Resolved: dual membership, personal tenant untouched.
- [x] Role-guard middleware shape (per-route vs. resolver decorator). — Resolved: `requireRole()` preHandler + resolver.
- [x] Entitlement source: new billing tier vs. add-on entitlement on existing tier. — Resolved: new `trainer` BillingTier value.

## Success Criteria

- [x] A billing-entitled trainer can invite a client and see only their own assigned clients.
- [x] Trainer creates a plan OWNED by client A; only client A can see/execute it.
- [x] Normal (non-trainer) users retain strict self-only access — no regression to 05b invariants.
- [x] One-trainer-per-client enforced at the data layer.

## Archive Note (2026-07-31)

Shipped in 5 chained slices, all merged to `main`: PR #277 (S1), #278 (S2), #279 (S3), #280 (S4), #281 (S5). See `sdd/15a-v2-trainer-account-access/archive-report` for full closure record.
