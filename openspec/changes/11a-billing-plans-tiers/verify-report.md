# Verify Report: 11a-billing-plans-tiers — Slice 2 / PR2

**Phase**: 2 (Core Billing / Gating) — tasks 2.1 / 2.2 / 2.3
**Branch**: `feat/11a-billing-plans-tiers-slice2` (uncommitted working tree)
**Mode**: Strict TDD | Full artifacts (proposal + spec + design + tasks + apply-progress)
**Verdict**: **PASS-WITH-NOTES**

---

## Executive Summary

All five required Phase 2 spec scenarios have real, asserting tests that pass at
runtime. Tasks 2.1/2.2/2.3 are genuinely satisfied (RED→GREEN→TRIANGLE) with no
scope leak into Phase 3/4. All repo quality gates pass. The apply-phase
deferred-risk (real Drizzle `QuotaLedgerRepository` atomicity/idempotency proven
only with a FakeLedger) was **closed** in this verify run: a bounded runtime
smoke of `CheckAndConsumeQuota` against live Postgres (pgvector:pg17) passed all
12 checks including the concurrency race and all-or-nothing member-cap atomicity.

CRITICAL: 0 | WARNING: 1 | SUGGESTION: 2

---

## Spec Scenario Compliance Matrix

| Scenario (required) | Covering test | Real assert? | Result |
|---|---|---|---|
| Hybrid Tenant Quotas — member allocation exhausted while tenant remains | `billing/__tests__/quota-consumption.test.ts` "denies member_allocation_exhausted … leaving the tenant counter untouched" | Yes | PASS (unit + runtime C2/C3) |
| Hybrid Tenant Quotas — tenant pool exhausted while member remains | same file "denies the next Free generation with tenant_quota_exhausted" | Yes | PASS (unit + runtime A4) |
| Hybrid Tenant Quotas — concurrent members race final tenant unit | same file "is race-safe: two members contending for the final tenant unit" | Yes | PASS (unit + runtime B1/B2 on real Postgres) |
| Generation Metering | `routes/__tests__/plan-generation.test.ts` "Generation metering gate" (5 tests: allow/deny confirm+regenerate, op-key shape) | Yes | PASS |
| Idempotent quota consumption retry | `billing/__tests__/quota-consumption.test.ts` "returns the prior decision on idempotent retry without consuming again" | Yes | PASS (unit + runtime A2/A3) |
| Empty operation key rejected | same file "rejects an empty operation key without touching the ledger (operation_key_required)" | Yes | PASS |
| Denied entitlement skips retrieval | `ai/__tests__/generation-service.memory.test.ts` "skips retrieval entirely when the memory entitlement is denied (fail-closed, no fallback)" | Yes | PASS |

Supporting entitlement coverage (`billing/__tests__/entitlement.test.ts`):
active-trial→pro, expired-trial→free+`trial_expired`, exact-boundary expired,
override precedence (`admin_override`), `premium_required` on Free, fail-closed
`inactive_membership` and `billing_state_unavailable`. All asserting; all pass.

No placeholder/`.skip`/`.todo` tests found among the covering tests.

## Fail-Closed Verification

| Invariant | Evidence | Result |
|---|---|---|
| Denied entitlement skips retrieval (no embedding/search, never a fallback) | `generation-service.ts attachMemoryContext` gate before try/catch; unit test asserts `retrieve` not called | PASS |
| Inactive/suspended membership denies | `entitlement.ts` denies `inactive_membership` before tier resolution; runtime D1 (suspended member re-checked inside consume tx) → `inactive_membership` | PASS |
| Missing billing state denies | `entitlement.ts` `billing_state_unavailable` when no billing row and no override | PASS |
| Empty op key never touches ledger | `quota-consumption.ts` early return; unit asserts `consumeSpy` not called | PASS |
| Route denial → 403, no generation started | `plan-generation.test.ts` deny tests assert `startGeneration` not called | PASS |
| Production route gate always wired | `app.ts` injects `billing` + `memoryEntitlement`; route optionality is a test seam only | PASS |

## Task Completion (RED→GREEN→TRIANGLE)

- 2.1 RED — failing tests added first (apply recorded 6 failed / 850 passed initial run). Satisfied.
- 2.2 GREEN — `billing/{types,plan-limits,entitlement,quota-consumption}.ts` + `db/repositories/billing-quota.ts` + gate wiring in `plan.ts`, `generation-service.ts`, `memory-retriever.ts`, `app.ts`. Satisfied.
- 2.3 TRIANGLE — atomic consume, concurrency race, retry idempotency, empty-key, fail-closed denial. Satisfied (unit) and now corroborated on live Postgres.

Phase 3 (3.1–3.3) and Phase 4 (4.1–4.3) remain `[ ]` — intentionally out of PR2 scope, not a blocker for this slice.

## Scope Leak Check (into Phase 3/4)

- No `apps/api/src/routes/billing.ts` (quota admin API) — absent, correct.
- No `apps/web/src/app/(app)/billing/` UI — absent (web build shows no `/billing` route), correct.
- No Stripe/checkout/webhook/payment/invoice/coupon/embedding/provider code in `apps/api/src/billing/*` or `billing-quota.ts` — grep clean.
- No `packages/contracts` change in this slice (DTOs landed in Slice 1) — clean.

## Gate Results (exact)

| Gate | Command | Result |
|---|---|---|
| Focused (work unit 2) | `pnpm --filter api test -- src/billing/__tests__/entitlement.test.ts src/routes/__tests__/plan-generation.test.ts src/routes/__tests__/user-memories.test.ts` | PASS — `Test Files 62 passed (62)`, `Tests 875 passed (875)` |
| Full API suite | (same invocation; Vitest collects full suite for positional paths — known behaviour) | PASS — 62 files / 875 tests |
| Type-check | `pnpm type-check` | PASS — all 6 workspaces `Done` |
| Architecture | `pnpm architecture` | PASS — `no dependency violations found (1591 modules, 4593 dependencies)`; negative guard passed |
| Deps-guard | `pnpm deps-guard` | PASS — no prohibited dependencies (6 package.json) |
| Build | `pnpm build` | PASS — all workspaces built; web routes emitted, no `/billing` |

## Runtime Smoke (deferred-risk closure) — DONE

Harness: `podman run pgvector/pgvector:pg17` on port 55433 →
`DATABASE_URL=… pnpm --filter api db:migrate` (migrations applied) →
`tsx` script exercising the REAL `BillingStateReaderRepository` +
`QuotaLedgerRepository` through `CheckAndConsumeQuota`/`CheckEntitlement`.
Container removed after run; no artifacts left in the tree.

| Check | Result |
|---|---|
| A1 first `plan_generation` consume allowed | PASS |
| A2 idempotent replay (same op key) allowed | PASS |
| A3 tenant counter still 1 after replay (no double-consume) | PASS |
| A4 second op → `tenant_quota_exhausted` | PASS |
| A5 counter not over-consumed (=1) | PASS |
| B1 two concurrent members race final unit → exactly one success | PASS |
| B2 regen counter == 1 (no over-consume under `Promise.all`) | PASS |
| C1 first member write allowed (Pro tenant, member cap 1) | PASS |
| C2 second → `member_allocation_exhausted` | PASS |
| C3 all-or-nothing: tenant counter == 1 after member denial | PASS |
| C4 member counter == 1 | PASS |
| D1 suspended membership denied at consume (`inactive_membership`, in-tx re-check) | PASS |

**SMOKE RESULT: 12 passed, 0 failed.** The `SELECT … FOR UPDATE` +
conditional-increment transaction and idempotency ledger behave correctly
against real Postgres, including the concurrency serialization and the
transactional membership re-check. The FakeLedger model is faithful to the
production adapter.

## Deviations from Design

1. (Accepted) Drizzle adapters placed in `apps/api/src/db/repositories/billing-quota.ts` rather than `apps/api/src/billing/*` — required by `.dependency-cruiser.cjs` (`api-no-db-outside-infra`). Pure use cases remain port-only under `billing/`. Architecture gate passes. Layering intent preserved.
2. (Accepted) Route billing gate is optional DI (test seam); `app.ts` always injects it in production → production fails closed.
3. (Accepted) Pro aggregate cap is provisional `PRO_FEATURE_LIMIT = 1_000_000`; 11a is provider-independent. Free numeric limits match spec exactly (gen 1, regen 1, memory 0). Exact Pro limits deferred to 11b.

## Issues

- **WARNING** — Premium `memory_write` route gating is not wired in this slice. Retrieval gating (generation path) is complete and tested, but the design's File-Changes table also lists `apps/api/src/routes/user-memories.ts` for premium write gates; that route is unchanged here. None of the five required Phase 2 scenarios depend on it, so it is a documented deferral, but it should be tracked and delivered in a later slice (Phase 3/4) so the "0 premium memory writes on Free" contract is enforced at the write route, not only via the schema/entitlement primitives.
- **SUGGESTION** — Mid-period tier downgrade (trial→free within the same calendar month) retains the already-initialised tenant counter `limit` for that period. Outside Phase 2 required scenarios; note for a later slice.
- **SUGGESTION** — Focused Vitest command collects the full API suite for positional paths (same known behaviour as Slice 1). Cosmetic; not a defect.

## Verdict

**PASS-WITH-NOTES.** Phase 2 is spec-compliant and fully proven at unit and
(now) live-Postgres runtime level. No CRITICAL issues; the one WARNING is a
tracked deferral that does not affect any required Phase 2 scenario. Safe to
proceed to review/PR for PR2, then Phase 3 (quota admin API).

---

# Verify Report: 11a-billing-plans-tiers — Slice 3 / PR3

**Phase**: 3 (Quota Admin API) — tasks 3.1 / 3.2 / 3.3
**Branch**: `feat/11a-billing-plans-tiers-slice3` (uncommitted working tree)
**Mode**: Strict TDD | Full artifacts (proposal + spec + design + tasks + apply-progress)
**Verdict**: **PASS**

---

## Executive Summary

All four Phase-3 spec scenarios have real, asserting tests that pass at runtime.
Tasks 3.1/3.2/3.3 are genuinely satisfied (RED→GREEN→TRIANGLE) with no scope leak
into Phase 4 (no web UI) or into Stripe/payment/provider work, and no
`CreateAdminOverride` implementation (correctly out of scope). The privacy
boundary is enforced structurally at three independent layers (response DTOs,
port type surface, SQL column selection). All repo quality gates pass, and the
billing-admin integration test (atomic audit write + aggregate-only reads)
passes against real Postgres (pgvector:pg17).

CRITICAL: 0 | WARNING: 0 | SUGGESTION: 2

---

## Spec Scenario Compliance Matrix

Requirement **Member Quota Administration** (spec `11a-v1-billing-plans-tiers`),
plus the task-named Cross-tenant guard:

| Scenario | Covering test | Real assert? | Result |
|---|---|---|---|
| Authorized trainer changes allocation (owner sets within bounds → allocation changes + audit written) | `routes/__tests__/billing.test.ts` "owner (trainer) sets an active member's allocation within bounds → 200 and writes it" + "passes the acting owner as the auditor to the atomic write" + integration "writeMemberAllocation persists the allocation AND a member_allocation_set audit row atomically" | Yes | PASS |
| Unauthorized member quota edit rejected | "rejects a non-owner member editing an allocation → 403 unauthorized_quota_admin, no write" | Yes | PASS |
| Trainer privacy boundaries (aggregate counts only; no memories/prompts/health/private content) | "owner sees tenant aggregate + per-member usage as COUNTS only" (asserts exact allowed key set + explicit forbidden-key absence) + "only ever asks the port for count reads — never for member content" | Yes | PASS |
| Inactive membership blocks management (Membership suspension) | "a suspended actor never reaches the route (auth re-check) → 401" + "the use case fails closed for a suspended actor (defense in depth)" + "an owner MAY still set a suspended member's allocation … but it grants no consumption" | Yes | PASS |
| Cross-tenant billing denied | "tenant scope always comes from authContext — a body tenantId is ignored" + "denies setting an allocation for a user who is NOT a member of the actor's tenant → 403" | Yes | PASS |

No placeholder / `.skip` / `.todo` tests among the covering tests. The 14
hermetic route+use-case tests and the 4 real-Postgres integration tests are all
genuinely asserting.

## Privacy Boundary Assessment (CRITICAL check) — PASS

Traced end to end; the boundary is enforced at three layers, defense in depth:

1. **Response DTOs** (`packages/contracts/src/index.ts`): `TenantUsageReportDTO`
   = `{ tenantUsage: TenantQuotaUsageDTO[], memberUsage: MemberQuotaUsageDTO[] }`;
   `SetMemberAllocationResponse` = `{ allocation: MemberAllocationDTO }`. Every
   field is an integer/enum/id (`feature`, `period`, `used`, `limit`, `userId`).
   No field can carry memory text, prompt, health data, or generated content.
2. **Port type surface** (`QuotaAdminPort` in `billing/quota-admin.ts`): the only
   reads are `readTenantUsage`/`readMemberUsage` (count DTOs) and membership/tier
   metadata. There is **no method** capable of returning member content — this is
   structurally impossible, and a test asserts the exact method set.
3. **SQL column selection** (`db/repositories/billing-admin.ts`): `readTenantUsage`
   selects only `feature/period/used/limit` from `tenant_quota_counters`;
   `readMemberUsage` selects only `userId/feature/period/used/limit` from
   `member_quota_counters`. It never touches memory/prompt/health/plan-content
   tables.

**Tenant isolation**: every query is scoped by `tenant_id` (and `user_id` for
member reads). Tenant + actor identity come from `request.authContext` only — a
body `tenantId` is ignored (tested). A subject who is not a member of the actor's
tenant is denied `unauthorized_quota_admin` with no other-tenant data read
(tested). **Fail-closed authorization**: `isActiveOwner` requires a non-null,
`active`, `owner` membership; missing / non-owner / non-active is denied. The
auth plugin additionally re-checks tenant-scoped membership status per request
(`membership.status !== "active"` → 401) before any handler runs — verified in
`auth/plugin.ts`.

## Owner-only vs "trainer" decision — CORRECT / ACCEPTABLE (not a gap)

The spec text says "owners/trainers" and "GIVEN trainer O **owns** tenant T". The
`membership_role` pgEnum is `["owner","member"]` — there is no distinct `trainer`
role, and `provisioning.ts` creates the tenant creator as `owner`. In a
trainer-managed tenant, the "trainer" **is** the tenant owner. Therefore
resolving the authorized quota administrator as an **active owner** is the
faithful, schema-backed reading of the spec, not a shortcut: the scenario's own
wording ("owns tenant T") maps exactly to `role === "owner"`. This is a correct
resolution — no trainer role needs to be added and no spec change is required for
11a. (SUGGESTION below: add a one-line spec clarification so future readers do
not mistake "trainer" for a separate role.)

## Audit + aggregate-only verification

- **Audit events written for admin actions**: proven on real Postgres — a
  `member_allocation_set` row (with `actorUserId`=owner, `subjectUserId`=member,
  `feature`, `period`, `metadata={limit}`) is written in the **same transaction**
  as the `member_quota_allocations` upsert; a second write upserts the limit and
  appends a **second** audit row (two writes → two rows).
- **Usage totals aggregate/count-only**: `readTenantUsage`/`readMemberUsage`
  return only count/limit columns; integration test asserts exact shapes and the
  key set carries no content field.

## Task Completion (RED→GREEN→TRIANGLE)

- 3.1 RED — failing route+use-case tests added first (target modules unresolved on first run). Satisfied.
- 3.2 GREEN — `billing/quota-admin.ts` (`SetMemberAllocation`, `GetTenantUsage`, `QuotaAdminPort`), `db/repositories/billing-admin.ts` adapter, `routes/billing.ts`, contract DTOs, `app.ts` wiring. Satisfied.
- 3.3 TRIANGLE — audit rows written (real Postgres), aggregate/count-only reads, no member content reachable (port surface + response-shape asserts). Satisfied.

Tasks 3.1/3.2/3.3 are `[x]` in `tasks.md` and match the code state. Phase 4
(4.1–4.3) remains `[ ]` — intentionally out of PR3 scope.

## Scope Leak Check

- No `apps/web/**` changes (`git status` clean for web) — no Phase-4 UI leak.
- No Stripe/checkout/webhook/invoice/payment_method/coupon strings in
  `routes/billing.ts`, `billing/quota-admin.ts`, or `db/repositories/billing-admin.ts` — grep clean.
- `CreateAdminOverride` not implemented (grep confirms absent) — correct, out of scope.
- Slice 1/2 schema, entitlement, consume, and gating code unchanged. Changed
  files are exactly: `app.ts`, `contracts/src/index.ts`, `apply-progress.md`,
  `tasks.md` (modified) + `quota-admin.ts`, `billing-admin.ts`, `routes/billing.ts`,
  `billing.test.ts`, `billing-admin.integration.test.ts` (new).

## Gate Results (exact)

| Gate | Command | Result |
|---|---|---|
| Focused (work unit 3) | `pnpm --filter api test src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` | PASS — `Test Files 2 passed (2)`, `Tests 24 passed (24)` |
| Full API suite (hermetic) | `pnpm --filter api test` | PASS — `Test Files 65 passed (65)`, `Tests 906 passed | 8 skipped (914)` |
| Type-check | `pnpm type-check` | PASS — all 6 workspaces `Done` |
| Architecture | `pnpm architecture` | PASS — `no dependency violations found (1597 modules, 4627 dependencies cruised)`; negative guard passed |
| Deps-guard | `pnpm deps-guard` | PASS — no prohibited dependencies (6 package.json) |
| Build | `pnpm build` | PASS — all workspaces built; web routes emitted, no `/billing` |

## Runtime Smoke (real Postgres) — DONE

Harness: `podman run pgvector/pgvector:pg17` on port 55434 →
`DATABASE_URL=… pnpm --filter api db:migrate` (migrations applied) →
`DATABASE_URL=… pnpm --filter api test src/db/repositories/__tests__/billing-admin.integration.test.ts`.
Container removed after run; no artifacts left in the tree.

| Check | Result |
|---|---|
| `writeMemberAllocation` persists allocation + `member_allocation_set` audit row atomically | PASS |
| Upsert: second write updates the limit and appends a second audit row (2 rows) | PASS |
| `readTenantUsage` / `readMemberUsage` return tenant-scoped aggregate COUNTS only (no content field) | PASS |
| `loadTenantTier` resolves the effective tier from billing state | PASS |

**SMOKE RESULT: 4 passed, 1 skipped (0 failed).** The atomic allocation+audit
transaction and the count-only aggregate reads behave correctly against real
Postgres.

## Deviations from Design

1. (Accepted) Drizzle adapter in `db/repositories/billing-admin.ts` rather than `billing/*` — required by `.dependency-cruiser.cjs` (`api-no-db-outside-infra`); pure use cases stay port-only in `billing/quota-admin.ts`. Consistent with Slice 2. Architecture gate passes.
2. (Accepted) Endpoint naming (`GET /billing/usage`, `PUT /billing/allocations`) is not fixed by the spec; RESTful choice; tenant id is never accepted from the client (always authContext).
3. (Accepted) `CreateAdminOverride` (listed in the design use-case set) is out of Phase-3 scope — it belongs to the separate "Admin Overrides" requirement and is intentionally not implemented in this slice.

## Issues

- **SUGGESTION** — Add a one-line clarification to the "Member Quota Administration" spec requirement that "trainer" denotes the `owner` of a trainer-managed tenant (no distinct `trainer` role in 11a), so future readers do not treat owner-only enforcement as a gap. Non-blocking.
- **SUGGESTION** — The Slice-3 test "an owner MAY set a suspended member's allocation … grants no consumption" asserts the management-side (write succeeds) but does not itself assert the consumption block; that block is correctly the responsibility of `CheckEntitlement` (`inactive_membership`) and is tested in Slice 2. Behavior is covered end to end; noted only for traceability. Non-blocking.

## Verdict

**PASS.** Phase 3 is spec-compliant and proven at unit and live-Postgres runtime
level. Zero CRITICAL, zero WARNING; two non-blocking SUGGESTIONs. The privacy
boundary is structurally enforced, tenant isolation and fail-closed authorization
are verified, admin actions are audited, and usage exposure is aggregate/count
only. The owner-only resolution of the spec's "trainer" wording is correct. No
scope leak into Phase 4 or Stripe. Safe to proceed to review/PR for PR3, then
Phase 4 (web billing UI + final verify/rollout).
