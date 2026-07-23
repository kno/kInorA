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

---

# Apply-Phase Evidence: 11a-billing-plans-tiers — Slice 4 / PR4

**Phase**: 4 (Web UI / Verification / Rollout) — tasks 4.1 / 4.2 / 4.3
**Branch**: `feat/11a-billing-plans-tiers-slice4` (uncommitted working tree)
**Mode**: Strict TDD | Full artifacts (proposal + spec + design + tasks + apply-progress)
**Author**: `sdd-apply` (this is apply-phase rollout/final-evidence, NOT an
independent `sdd-verify` pass — recommend `sdd-verify` still runs its own
adversarial check before PR4 review, per the normal SDD lifecycle)

---

## Scope-gap resolution (recap)

Slice 3 shipped only an OWNER-ONLY `GET /billing/usage` (counts only, no
tier/status/trial/override). The `Billing State Visibility` requirement
(`specs/11a-v1-billing-plans-tiers/spec.md:69-71`) is explicitly UI-AND-API
scoped ("The UI and API SHOULD expose tenant tier, status, trial end, active
override end, denial reason, upgrade prompt destination..."), and
`BillingVisibilityDTO`/`TenantBillingStateDTO` already existed unwired in
`packages/contracts/src/index.ts` (Slice 1). The orchestrator explicitly
authorized wiring a member-facing `GET /billing/visibility` as part of Phase 4
(not a new invented contract — the existing DTO). See `apply-progress.md`
Slice 4 section for full detail.

## Spec Scenario Compliance Matrix

Requirement **Billing State Visibility** (spec `11a-v1-billing-plans-tiers`):

| Scenario | Covering test | Real assert? | Result |
|---|---|---|---|
| Active trial badge | `BillingPageClient.test.tsx` "shows the trial badge with tier Pro and no upgrade prompt while trialing"; `billing-visibility.test.ts` "shows trial badge fields (tier pro, trialEndsAt) while a trial is active" | Yes | PASS |
| Empty billing state is backfilled | `billing-visibility.test.ts` "a backfilled Free tenant returns a deterministic Free state with an upgrade prompt"; `billing-visibility.integration.test.ts` "loadContext resolves the tenant billing row (no active override)" (real Postgres) | Yes | PASS |
| Tenant switching refreshes billing (from the new tenant only) | `BillingPageClient.test.tsx` "refreshes billing data from the new tenant only when the tab regains focus (tenant switch)" — asserts the STALE tenant's data is gone (`queryByText("Free")` is null), not merged | Yes | PASS |

Additional Phase-4 coverage beyond the three named scenarios (loading/empty/error/offline/a11y, EN/ES parity — explicitly required by task 4.1):

| Scenario | Covering test | Result |
|---|---|---|
| Own-usage-only privacy (a member never sees another member's usage) | `billing-visibility.test.ts` "a second member never sees the first member's individual usage through this endpoint"; `billing-visibility.integration.test.ts` "readOwnMemberUsage returns ONLY the requested member's rows, never another member's" (real Postgres, two real seeded members) | PASS |
| Suspended member denied | `billing-visibility.test.ts` "a suspended member is denied before the handler runs (401, auth re-check)" | PASS |
| Loading/empty/error/offline states + a11y | `BillingPageClient.test.tsx` (8 tests: `progressbar`/`status` roles, retry-focus on error/offline, empty-usage message) | PASS |
| EN/ES i18n parity | `packages/i18n/src/__tests__/index.test.ts` "the full catalogs pass the parity/ICU-arg guard" (609→643 keys, +34 `billing.*`) | PASS |

No placeholder / `.skip` / `.todo` tests among the covering tests.

## Privacy Boundary Assessment — PASS

`GetBillingVisibility.execute` calls `port.readOwnMemberUsage(scope.tenantId,
scope.userId, period)` — `scope.userId` is ALWAYS the authenticated caller's
own id from `request.authContext`, never a request parameter. The
`BillingVisibilityPort` type surface has no method that accepts an arbitrary
`userId` for another member's usage. Proven with REAL rows (not fakes) in
`billing-visibility.integration.test.ts`: two members seeded in the same
tenant/period, `readOwnMemberUsage` for member A returns only A's row and vice
versa. `tenantUsage` remains aggregate-only (no per-member breakdown exposed
to a non-owner via this endpoint — that stays owner-only via `GET /billing/usage`).

## Task Completion (RED→GREEN→TRIANGLE)

- 4.1 RED — failing API test (`billing-visibility.test.ts`, module-not-found) and failing web/i18n tests (`billing-client.test.ts`, `page.test.tsx`, `BillingPageClient.test.tsx`, module-not-found) added first. Satisfied.
- 4.2 GREEN — `GetBillingVisibility` + `BillingVisibilityRepository` + `GET /billing/visibility` (API); `page.tsx` + `BillingPageClient.tsx` + `billing-client.ts` + `actions.ts` + `loading.tsx` (web); 34 `billing.*` i18n keys in both EN/ES. Satisfied.
- 4.3 TRIANGLE — real-Postgres proof of the new adapter, full suite regressions checked, all repo gates green, production-build runtime smoke of the SSR error path. Satisfied.

Tasks 4.1/4.2/4.3 are `[x]` in `tasks.md`. 11a is feature-complete (Phases 1–4 all `[x]`); Stripe/payment-provider work is explicitly out of 11a scope (11b).

## Scope Leak Check

- No Stripe/checkout/webhook/invoice/payment_method/coupon strings introduced — grep clean across all new/changed files.
- `CreateAdminOverride` still not implemented (out of 11a's Phase-3/4 named scenarios).
- Slice 1/2/3 schema, entitlement, consume, gating, and quota-admin (`GET /billing/usage`, `PUT /billing/allocations`) code and behavior unchanged — `billing.test.ts`'s Slice 3 assertions still pass unmodified; only a required stub option was added to satisfy the plugin's expanded `BillingRoutesOptions`.

## Gate Results (exact)

| Gate | Command | Result |
|---|---|---|
| Focused (work unit 4, API) | `pnpm --filter api test src/routes/__tests__/billing-visibility.test.ts src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` | PASS — `Test Files 3 passed`, `Tests 30 passed` |
| Focused (work unit 4, web) | `pnpm --filter web test -- "src/app/(app)/billing/__tests__"` | PASS — `Test Files 100 passed`, `Tests 856 passed` |
| i18n suite | `pnpm --filter @kinora/i18n test` | PASS — `Test Files 5 passed`, `Tests 29 passed` |
| Full API suite (real Postgres) | `pnpm --filter api test` (`DATABASE_URL` → pgvector:pg17) | PASS — `Test Files 67 passed`, `Tests 922 passed \| 3 skipped` |
| Full API suite (hermetic) | `pnpm --filter api test` | PASS — `Test Files 66 passed`, `Tests 912 passed \| 8 skipped` |
| Full web suite | `pnpm --filter web test` | PASS — `Test Files 100 passed`, `Tests 856 passed` |
| Type-check | `pnpm type-check` | PASS — all 6 workspaces `Done` |
| Architecture | `pnpm architecture` | PASS — `no dependency violations found (1600 modules, 4648 dependencies cruised)`; negative guard passed |
| Deps-guard | `pnpm deps-guard` | PASS — no prohibited dependencies |
| Build | `pnpm build` | PASS — all workspaces built; web routes include `/billing` |

## Runtime Smoke — DONE (two independent proofs)

**Real Postgres** (adapter-level): `podman run pgvector/pgvector:pg17` on port
55435 → `DATABASE_URL=… pnpm --filter api db:migrate` →
`DATABASE_URL=… pnpm --filter api test src/db/repositories/__tests__/billing-visibility.integration.test.ts`.
Container removed after run; no artifacts left in the tree.

| Check | Result |
|---|---|
| `loadContext` resolves the tenant billing row (no active override) | PASS |
| `loadContext` resolves an ACTIVE admin override's tier AND `endsAt` | PASS |
| `readOwnMemberUsage` returns ONLY the requested member's rows across two real seeded members | PASS |
| `readTenantUsage` returns tenant-scoped aggregate counts | PASS |

**SMOKE RESULT: 4 passed, 1 skipped (0 failed).**

**Production build** (SSR-level): `pnpm --filter web build` (lists `/billing`
as a registered route) → `pnpm --filter web start` (port 4173,
`API_BASE_URL` pointed at an unreachable host) → `curl http://127.0.0.1:4173/billing`.

| Check | Result |
|---|---|
| HTTP status | 200 |
| Real (non-jsdom) error-state copy rendered (`"We could not load your billing"`) | PASS |
| Page shell class present (`kin-page`) | PASS |

## Deviations from Design

1. (Accepted, authorized by orchestrator) `GetBillingVisibility` use case + `GET /billing/visibility` route were added in Phase 4 — the design's File Changes table only named the owner-only `GetTenantUsage` (Slice 3); the member-facing read is required by the spec's UI-AND-API wording and wires the ALREADY-DEFINED `BillingVisibilityDTO` contract rather than inventing a new shape.
2. (Accepted) Drizzle adapter in `db/repositories/billing-visibility.ts` rather than `billing/*` — required by `.dependency-cruiser.cjs` (`api-no-db-outside-infra`); consistent with Slices 2/3.
3. (Accepted) `upgradePromptPath` is hardcoded to `"/billing"` (self-referential) since 11a has no Stripe/checkout destination; `denialReason` uses `memory_write`'s resolved limit as the representative premium-gate check. Both are resolved implementation calls, not spec-fixed values — see Issues below.
4. (Accepted) No dedicated tenant-switcher UI exists in the web app; "tenant switching refreshes billing" is satisfied by the server component always reading the current session cookie plus a client-side `window.focus`/`visibilitychange` refresh that REPLACES (never merges) state.

## Issues

- **SUGGESTION** — `upgradePromptPath: "/billing"` and the `memory_write`-as-representative-premium-feature choice for `denialReason` should be revisited once 11b (Stripe) introduces a real upgrade/checkout destination and a possible per-feature denial UX. Non-blocking for 11a (no payment provider in scope).
- **SUGGESTION** — A live two-server (`pnpm --filter api dev` + `pnpm --filter web dev`) browser session with two real tenants was not run; the focus/visibility refresh mechanism is proven in jsdom against a mocked Server Action, and the SSR path is proven against a real production server, but not combined into one live end-to-end session. Recommend as a manual QA step before merge, not a blocker (the refresh calls the SAME action already proven at the HTTP+adapter boundary).
- **SUGGESTION** — Consider adding a dedicated tenant-switcher UI component in a follow-up (out of 11a scope) — its absence made "tenant switching refreshes billing" a session/cookie-driven behavior rather than an in-app UI-driven one.

## Verdict

**PASS (apply-phase evidence).** Phase 4 is spec-compliant and proven at unit,
real-Postgres, and real-production-build runtime levels. Zero CRITICAL, zero
WARNING; three non-blocking SUGGESTIONs, all product/QA follow-ups rather than
defects. The privacy boundary (own-usage-only) is proven structurally and
against real seeded rows. No scope leak into Stripe/11b. 11a (all four phases)
is feature-complete. Recommend `sdd-verify` run its own independent pass before
PR4 review, and flag the Workload/PR-Boundary note in `apply-progress.md`
(API+web+tests+i18n combined may be near/over the 400-line authored-code
budget for one PR) to the orchestrator for a chaining decision.

---

# Verify Report: 11a-billing-plans-tiers — Slice 4 / PR4 (independent sdd-verify)

**Phase**: 4 (Web UI / Verification / Rollout) — tasks 4.1 / 4.2 / 4.3
**Branch**: `feat/11a-billing-plans-tiers-slice4` (uncommitted working tree)
**Mode**: Strict TDD | Full artifacts (proposal + spec + design + tasks + apply-progress)
**Author**: `sdd-verify` (independent adversarial pass, NOT the apply-phase evidence above)
**Verdict**: **PASS-WITH-NOTES**

---

## Executive Summary

All three named `Billing State Visibility` spec scenarios (Active trial badge,
Empty billing state backfilled, Tenant switching refreshes billing) plus the
task-4.1-required loading/empty/error/offline/a11y and EN/ES-parity coverage
have real, asserting tests that pass at runtime. Tasks 4.1/4.2/4.3 are genuinely
satisfied (RED->GREEN->TRIANGLE). No Stripe/payment/provider code introduced. The
member-facing privacy boundary is enforced structurally and proven against real
seeded Postgres rows. Every repo gate is green and re-run in this pass. The three
apply-flagged deviations are all acceptable for 11a (product/QA follow-ups).

**CRITICAL: 0 | WARNING: 0 | SUGGESTION: 3**

## Spec Scenario Compliance Matrix — Requirement "Billing State Visibility"

| Scenario | Covering test (verified genuine + passing) | Result |
|---|---|---|
| Active trial badge | `BillingPageClient.test.tsx` "shows the trial badge with tier Pro and no upgrade prompt while trialing" (asserts Pro shown, upgrade link null) + API `billing-visibility.test.ts` "shows trial badge fields (tier pro, trialEndsAt) while a trial is active" (asserts tier=pro, status=trialing, exact trialEndsAt) | PASS |
| Empty billing state is backfilled (deterministic Free) | API `billing-visibility.test.ts` "a backfilled Free tenant returns a deterministic Free state with an upgrade prompt" (asserts tier=free/status=active/source=backfill, denialReason=premium_required, upgradePromptPath=/billing) + integration "loadContext resolves the tenant billing row (no active override)" on real Postgres | PASS |
| Tenant switching refreshes billing (from new tenant ONLY, replace not merge) | `BillingPageClient.test.tsx` "refreshes billing data from the new tenant only when the tab regains focus" — after focus-refresh to a Pro/trialing tenant it asserts getByText("Pro") present AND queryByText("Free") is null (stale tenant data replaced, not merged) | PASS |
| Own-usage-only privacy (member never sees another member's usage) | API "a second member never sees the first member's individual usage through this endpoint" (each caller's readOwnMemberUsage invoked with its OWN id only) + integration "readOwnMemberUsage returns ONLY the requested member's rows" on two REAL seeded members | PASS |
| Suspended member denied | API "a suspended member is denied before the handler runs (401, auth re-check)" — loadContext never called | PASS |
| Loading / empty / error / offline + a11y | `BillingPageClient.test.tsx` (8 tests): role=status/role=progressbar on loading, aria-label on progressbar, retry button receives focus on error/offline, aria-labeled usage lists, empty-usage message | PASS |
| EN/ES i18n parity + neutral Spanish | i18n parity/ICU-arg guard green; independent leaf-key diff = 34 EN / 34 ES billing.* keys, ZERO missing either side; ICU placeholders ({daysRemaining, plural...}, {feature}/{used}/{limit}) match; Spanish register neutral/professional | PASS |

No placeholder / .skip / .todo among covering tests. Assertion-quality audit
found no tautologies, no smoke-only tests, no ghost loops — all assertions call
production code and check concrete values.

## Privacy Boundary Assessment (CRITICAL check) — PASS

Traced end to end for the new member-facing `GET /billing/visibility`:

- Identity source: route reads `const { tenantId, userId } = request.authContext!` and calls `getBillingVisibility.execute({ tenantId, userId }, period)`. Neither tenantId nor userId is ever taken from the query/body. The `period` query param is the only client input and is regex-validated (`/^\d{4}-\d{2}$/`), defaulting to the current period.
- Use case (`billing/billing-visibility.ts`): calls `port.readOwnMemberUsage(scope.tenantId, scope.userId, period)` — always the caller's own id. The `BillingVisibilityPort` type surface has NO method that accepts an arbitrary member id for another member's usage; reading another member is structurally impossible.
- Drizzle adapter (`db/repositories/billing-visibility.ts`): `readOwnMemberUsage` is filtered by and(eq(tenantId), eq(memberQuotaCounters.userId, userId), eq(period)) and selects only userId/feature/period/used/limit. `readTenantUsage` selects only aggregate feature/period/used/limit. `loadContext` reads only membership status, billing-state metadata, and active-override tier/endsAt. No memory/prompt/health/plan-content table is ever touched.
- Response DTO (`BillingVisibilityDTO`): tenant billing state (tier/status/source/trial/override/updatedAt) + tenant aggregate usage counts + the requester's own usage counts + optional denialReason/upgradePromptPath. Every field is an integer/enum/id/ISO-date — no field can carry another member's private content.
- Second-member cannot read first member: proven twice — hermetically (mock port asserts each caller's readOwnMemberUsage was invoked with its own id) and against real Postgres (two real seeded members in the same tenant/period; A's read returns only A's row, B's only B's).
- Fail-closed: membershipStatus !== "active" -> inactive_membership; missing billing state and no override -> billing_state_unavailable; and the auth plugin re-checks membership status per request, so a suspended member gets 401 before the handler runs (loadContext never called — tested). tenantId+userId strictly from authContext.

## Task Completion (RED->GREEN->TRIANGLE)

- 4.1 RED — API `billing-visibility.test.ts` (module-not-found) + web billing-client/page/BillingPageClient tests (module-not-found) + i18n key-count/parity updated before keys existed. Satisfied.
- 4.2 GREEN — GetBillingVisibility + BillingVisibilityRepository + GET /billing/visibility; page.tsx/BillingPageClient.tsx/billing-client.ts/actions.ts/loading.tsx; 34 billing.* EN/ES keys. Satisfied.
- 4.3 TRIANGLE — real-Postgres adapter proof, full-suite regressions, all gates, production-build SSR smoke. Satisfied.

Tasks 4.1/4.2/4.3 are `[x]` in tasks.md and match code state. All Phase 1–4 tasks `[x]`; 11a feature-complete. Stripe/payment is 11b (out of scope).

## Gate Results (exact — all re-run in THIS verify pass)

| Gate | Command | Result |
|---|---|---|
| Focused API (WU4) | `pnpm --filter api test src/routes/__tests__/billing-visibility.test.ts src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` | PASS — Test Files 3 passed, Tests 30 passed |
| Focused web (WU4) | `pnpm --filter web test -- "src/app/(app)/billing/__tests__"` | PASS — Test Files 100 passed, Tests 856 passed (web vitest runs full project per invocation; 3 billing files included/green) |
| i18n suite | `pnpm --filter @kinora/i18n test` | PASS — Test Files 5 passed, Tests 29 passed |
| Full API (hermetic) | `pnpm --filter api test` | PASS — Test Files 67 passed, Tests 913 passed \| 12 skipped (925) |
| Full web suite | `pnpm --filter web test` (via focused invocation running whole project) | PASS — Test Files 100 passed, Tests 856 passed |
| Billing-visibility integration (real Postgres) | `DATABASE_URL=...:55440 pnpm --filter api test src/db/repositories/__tests__/billing-visibility.integration.test.ts` (podman pgvector:pg17, migrated) | PASS — 4 passed \| 1 skipped (override tier+endsAt, no-override baseline, own-usage-only isolation across two real members, tenant aggregate) |
| Type-check | `pnpm type-check` | PASS — all 6 workspaces Done |
| Architecture | `pnpm architecture` | PASS — no dependency violations found (1601 modules, 4652 dependencies cruised); negative guard passed |
| Deps-guard | `pnpm deps-guard` | PASS — no prohibited dependencies (6 package.json) |
| Build | `pnpm build` (deps-guard + ui-api-guard + architecture + -r build) | PASS — /billing registered as dynamic route (f /billing) |
| Lint | (no `lint` script exists at root or in any workspace) | N/A — repo has no lint gate; static guards are deps-guard + ui-api-guard + architecture (all in build, all green) |

## Runtime Smoke (real Postgres) — DONE in this pass

Harness: podman run pgvector/pgvector:pg17 (port 55440) -> CREATE EXTENSION vector
-> DATABASE_URL=... pnpm --filter api db:migrate (applied) -> integration suite.
Container removed after run (podman rm -f kinora-billing-verify); no artifacts left.

| Check | Result |
|---|---|
| loadContext resolves tenant billing row (no active override) | PASS |
| loadContext resolves ACTIVE override tier + endsAt | PASS |
| readOwnMemberUsage returns ONLY the requested member's rows (two real seeded members) | PASS |
| readTenantUsage returns tenant-scoped aggregate counts | PASS |

The production-build SSR smoke (next start + curl /billing against an unreachable
API -> HTTP 200 with the real error-state copy) recorded in the apply-phase
evidence above was NOT re-executed in this pass; the SSR error path is
independently covered by page.test.tsx (error -> initialError passed to client)
and the client error state by BillingPageClient.test.tsx.

## Deviation Judgments (apply-flagged)

1. upgradePromptPath hardcoded to "/billing" (self-referential) — ACCEPTABLE for 11a. 11a explicitly excludes Stripe/checkout, so there is no checkout destination to link to; routing the CTA to the billing page (which surfaces the upgrade prompt) is a coherent resolved product call, not a spec violation (the spec field is "upgrade prompt destination", unconstrained in 11a). Revisit in 11b. -> SUGGESTION.
2. denialReason uses memory_write limit as representative premium check — ACCEPTABLE for 11a. resolveTenantFeatureLimit(tier, "memory_write") is 0 for Free/expired-trial, mirroring the exact denial CheckEntitlement produces for any premium AI action; surfacing one consistent upgrade prompt avoids duplicating per-feature gate logic. Consistent with the spec's "premium AI capabilities show upgrade prompts". Per-feature denial UX is an 11b concern. -> SUGGESTION.
3. No tenant-switcher UI; refresh via focus/visibilitychange — ACCEPTABLE for 11a. A repo-wide search confirms no tenant-switch affordance exists anywhere in the web app, so there is no component to hook into. The mechanism satisfies the spec's intent: the server component always reads the current session cookie and the client refetch REPLACES (never merges) state — the "replace not merge" guarantee is directly asserted (queryByText("Free") null after switch). A live two-server two-tenant browser session was not run (jsdom + real-EN catalog + SSR each proven at their own boundary). -> SUGGESTION (manual QA follow-up before merge).

None of the three deviations block: the requirement is a SHOULD, all three named scenarios have genuine passing tests, and each deviation is a resolved product/QA follow-up rather than a defect.

## Scope Leak Check

- No Stripe/checkout/webhook/invoice/payment_method/coupon strings in any new/changed billing file — confirmed.
- CreateAdminOverride still not implemented (out of 11a's named scenarios) — correct.
- Slice 1/2/3 behavior unchanged; only additive test-plumbing (getBillingVisibility stub) added to billing.test.ts to satisfy the expanded BillingRoutesOptions — Slice 3's 14 assertions still pass unmodified.

## Issues

- SUGGESTION — upgradePromptPath: "/billing" and the memory_write-as-representative-premium-feature choice for denialReason should be revisited when 11b introduces a real checkout destination and possible per-feature denial UX. Non-blocking.
- SUGGESTION — No live two-server (api+web) two-tenant browser session was run; the focus/visibility refresh is proven in jsdom against a mocked Server Action and the SSR path against a real server, but not combined end to end. Recommend a manual QA step before merge.
- SUGGESTION — Consider a dedicated tenant-switcher UI component in a follow-up (out of 11a scope); its absence makes "tenant switching refreshes billing" a session/cookie + focus-refresh behavior rather than an in-app UI-driven one.

## Verdict

**PASS-WITH-NOTES.** Phase 4 is spec-compliant and independently proven at unit,
real-Postgres, and gate level in this verify pass. Zero CRITICAL, zero WARNING;
three non-blocking SUGGESTIONs (all product/QA follow-ups for 11b, not defects).
The member-facing privacy boundary (own-usage-only, tenant+user strictly from
authContext, fail-closed on inactive/suspended) is structurally enforced and
proven against real seeded rows. EN/ES i18n parity is exact (34/34) with neutral
Spanish. No Stripe/payment leak; 11a is feature-complete. Safe to proceed to
PR4 review/archive; carry the three SUGGESTIONs into 11b/QA.
