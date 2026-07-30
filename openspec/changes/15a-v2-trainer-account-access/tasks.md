# Tasks: Trainer Account Access (v2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2100-2500 total (S1 ~250, S2 ~350, S3 ~450, S4 ~400, S5 ~650) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (S1) → PR2 (S2) → PR3 (S3) → PR4 (S4) → PR5 (S5) |
| Delivery strategy | ask-on-risk (resolved: stacked-to-main for this run) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved by orchestrator: chained PRs, stacked-to-main, S1 only for this run)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S1 | Schema+contracts+entitlement (no behavior change) | PR 1 | `pnpm --filter api test db/schema` | drizzle migrate against local pg (docker) | drop table/enum values; no route wired yet |
| S2 | Authorization resolver + guard + regression guard | PR 2 | `pnpm --filter api test trainer/owner-access` | none (pure unit, no live route) | delete `owner-access.ts`; unused until S4 wires it |
| S3 | Invite/assignment flow | PR 3 | `pnpm --filter api test trainer/routes` | local api + pg integration test | revert `routes/trainer.ts` invite/list endpoints |
| S4 | Client-owned plan creation | PR 4 | `pnpm --filter api test plan/create-for-client` | local api + pg e2e (invite→create→visibility) | revert `routes/plan.ts` ownerUserId threading |
| S5 | Web + mobile client-list / create-plan-for-client UI | PR 5 | `pnpm --filter web test client-list`, `pnpm --filter mobile test client-list` | Playwright e2e against local api | remove new UI routes/screens |

Independently shippable: S1 (schema only, dark). Dependent chain: S2 depends on S1 (role/tier/table exist); S3 depends on S2 (resolver+guard); S4 depends on S3 (assignment must exist to create for client); S5 depends on S4 (needs working API). Ordering rationale: security seam (S2) ships before any route can widen access, and is reviewed in isolation from feature logic (S3/S4) to keep the auth diff small and auditable.

## Phase 1 (Slice S1): Schema, Contracts, Entitlement — no behavior change

- [x] 1.1 RED: write migration test asserting `trainer` exists in `membership_role` and `billing_tier` enums, `trainer_assignment_status` enum exists, `trainer_client_assignments` table + partial unique index `(client_user_id) WHERE status <> 'revoked'` + `unique(tenant_id, client_user_id)` exist.
- [x] 1.2 GREEN: add migration step A — `ALTER TYPE membership_role ADD VALUE 'trainer'`; `ALTER TYPE billing_tier ADD VALUE 'trainer'` (separate migration file per Postgres same-transaction gotcha).
- [x] 1.3 GREEN: add migration step B (separate file) — create `trainer_assignment_status` enum + `trainer_client_assignments` table + both indexes in `apps/api/src/db/schema.ts`.
- [x] 1.4 RED: write `resolveTenantFeatureLimit("trainer", ...)` test expecting non-Free limits (currently fails/falls back to Free).
- [x] 1.5 GREEN: add `TRAINER_TIER_LIMITS` (≥ pro) in `apps/api/src/billing/plan-limits.ts`.
- [x] 1.6 GREEN: extend `MembershipRole`/`BillingTier` unions, add `TrainerAssignmentStatus`, `TrainerClientAssignmentDTO`, `InviteClientRequest`, `ClientSummaryDTO` in `packages/contracts/src/index.ts`.
- [x] 1.7 Create `apps/api/src/db/repositories/trainer-assignment.ts` with CRUD + `findActiveAssignment(tenantId, trainerUserId, clientUserId)` (no route wiring yet).

## Phase 2 (Slice S2): Authorization Resolver + Guard — heavily reviewed

- [x] 2.1 RED: `resolveAuthorizedOwner` — self path: no `requested` → returns `ctx.actorUserId`.
- [x] 2.2 RED: `resolveAuthorizedOwner` — `member` role requesting another user's id → throws `ForbiddenOwnerAccess`.
- [x] 2.3 RED: `resolveAuthorizedOwner` — `trainer` role, tier not `"trainer"` (entitlement missing) → throws.
- [x] 2.4 RED: `resolveAuthorizedOwner` — `trainer` role + entitled, but no assignment row → throws.
- [x] 2.5 RED: `resolveAuthorizedOwner` — `trainer` role + entitled, assignment `status="revoked"` → throws.
- [x] 2.6 RED: `resolveAuthorizedOwner` — `trainer` role + entitled + assignment `status="active"` → returns `requested` (positive case, last).
- [x] 2.7 GREEN: implement `ActorOwnerContext`, `resolveAuthorizedOwner`, `ForbiddenOwnerAccess` in `apps/api/src/trainer/owner-access.ts` per design's deny-by-default order (role → tier → assignment).
- [x] 2.8 RED: extend `findByTenantAndUser` test to assert returned row includes `role`.
- [x] 2.9 GREEN: modify `apps/api/src/db/repositories/auth-context.ts` `findByTenantAndUser` to return `role`; attach `role` to `SessionContext` in `apps/api/src/auth/plugin.ts`.
- [x] 2.10 RED: `requireRole("trainer")` preHandler test — non-trainer role → 403; trainer role → passes through.
- [x] 2.11 GREEN: implement `requireRole()` guard in `apps/api/src/auth/plugin.ts`.
- [x] 2.12 Regression guard (CORRECTED per apply-time review): `apps/api/src/trainer/__tests__/route-authz-guard.test.ts` enumerates `TRAINER_SCOPED_ROUTES` (empty in S2 — S3 task 3.8 / S4 task 4.5 extend it as each trainer-scoped route lands) via `it.each` (zero cases now, a legitimate pass, not a skip) AND directly asserts the resolver's own deny-by-default invariants (self-only for non-trainer roles; trainer needs role+entitlement+active-assignment; non-assigned/wrong-client denied). GREEN on this branch, not intentionally red — S2 must be independently mergeable with a fully passing suite.
- [x] 2.13 Integration: non-trainer request for another user's `plan_spec`/`workout_plan` still returns `undefined` — already covered by existing, unmodified tests in `plan-spec.test.ts` ("returns undefined for a confirmed spec owned by another user", cross-tenant isolation) and `workout-plan.test.ts`; PlanSpecRepository/WorkoutPlanRepository were not touched in this slice, confirming repo isolation and the self path are unaffected.

## Phase 3 (Slice S3): Invite/Assignment Flow

- [x] 3.1 RED: `POST /trainer/clients/invite` — non-trainer/non-entitled caller → 403.
- [x] 3.2 RED: `POST /trainer/clients/invite` — valid trainer, new email → creates membership row (status `invited`) + `trainer_client_assignments` row (status `invited`).
- [x] 3.3 RED: invite acceptance transitions membership + assignment to `active`.
- [x] 3.4 RED: one-trainer-per-client unique violation — second trainer inviting an already-assigned client → constraint error surfaced as 409.
- [x] 3.5 RED: `GET /trainer/clients` — returns only assignments where `trainer_user_id = actor`, using `ClientSummaryDTO`.
- [x] 3.6 GREEN: implement invite/accept/list endpoints in `apps/api/src/routes/trainer.ts`, wired through `requireRole("trainer")` + assignment repo from S1.
- [x] 3.7 GREEN: session active-tenant-selection minimal enabler — `apps/api/src/auth/tenant-selection.ts` (`selectActiveTenant`, pure + unit-tested) + `MembershipRepository.findActiveMemberships` (`auth-context.ts`). Deliberately NOT wired into the default login path (`social.ts`) this slice — see deviations note; the client-facing consumption is deferred with the plan-VIEW (S5/follow-up).
- [x] 3.8 Extended the S2 regression guard (2.12): `TRAINER_SCOPED_ROUTES` now enumerates `POST /trainer/clients/invite` and `GET /trainer/clients`, with real route-level probes (via the actual `trainerRoutes` plugin) proving both deny (403) before any repo call for a non-trainer role AND for a trainer role without the trainer entitlement. GREEN.

## Phase 4 (Slice S4): Client-Owned Plan Creation

- [x] 4.1 RED: `POST /clients/:clientUserId/plan-specs` — trainer entitled, assignment active → spec created with `ownerUserId = clientUserId`, `tenantId = trainerTenantId`.
- [x] 4.2 RED: `POST /clients/:clientUserId/plan-specs` — trainer with no/revoked assignment for `:clientUserId` → 403 (matches design's non-assigned-client case).
- [x] 4.3 RED: quota/limits check — plan creation for a client is metered against the trainer's tenant quota, not the client's personal tenant.
- [x] 4.4 GREEN: modify `apps/api/src/routes/plan.ts` to derive `ActorOwnerContext`, call `resolveAuthorizedOwner(ctx, clientUserId)`, then thread `ownerUserId` into the spec-creation path (`PlanRouteRepo.promoteDraftToSpec` — reused byte-identically, the paired draft-delete is a documented no-op with no prior draft) and `ai/generation-service.ts` `startGeneration`.
- [x] 4.5 Update the S2/S3 regression guard (2.12/3.8) fixture list to include `plan.ts`'s client-owned-creation route (`POST /clients/:clientUserId/plan-specs`), with real route-level probes (via the actual `planRoutes` plugin) proving deny-before-any-repo/generation/billing-call for a non-trainer role AND a trainer without the entitlement; confirm full green.
- [x] 4.6 E2E: invite → accept (replicated directly via the assignment repo) → trainer creates plan for client → client (session scoped to trainer tenant) sees and executes only that plan; a different, unassigned client sees nothing; trainer's own tenant/userId is what the billing ledger records, never the client's.

## Phase 5 (Slice S5): Web + Mobile Surfaces

- [ ] 5.1 RED (web): client-list page renders `ClientSummaryDTO[]` from `GET /trainer/clients`, empty state, error state.
- [ ] 5.2 GREEN (web): implement client-list view + invite-client form in `apps/web`.
- [ ] 5.3 RED (web): create-plan-for-client flow — selecting a client threads `clientUserId` into existing plan-creation wizard.
- [ ] 5.4 GREEN (web): wire create-plan-for-client surface in `apps/web`.
- [ ] 5.5 RED (mobile): equivalent client-list screen test in `apps/mobile`.
- [ ] 5.6 GREEN (mobile): implement client-list + invite screen in `apps/mobile`.
- [ ] 5.7 GREEN (mobile): create-plan-for-client screen in `apps/mobile`.
- [ ] 5.8 DEFERRED (explicit, not built this change): client-facing view of trainer-built plans depends on active-tenant selection UX (design Open Question) — track as a follow-up item, do not implement in this slice.

## Phase 6: Cleanup / Docs

- [ ] 6.1 Update `openspec/specs/{05b,11a}/spec.md` deltas confirmation notes (already drafted in specs/) once archived.
- [ ] 6.2 Remove feature flag gating trainer registration once S5 is verified in staging (rollout step from design).
