# Apply Progress: 11a-billing-plans-tiers — Slice 1

**Batch**: Slice 1 / Phase 1 — schema, migration, backfill foundation
**Delivery**: chained PR slice (`stacked-to-main`)
**Mode**: Strict TDD
**Status**: Slice 1 complete — Phase 1 tasks 1.1, 1.2, 1.3 are `[x]`

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/api/src/db/__tests__/billing-schema.test.ts`, `apps/api/src/db/repositories/__tests__/billing-backfill.test.ts`, `apps/api/src/tenant/__tests__/provisioning.test.ts` | Unit | ✅ `pnpm --filter api test -- src/tenant/__tests__/provisioning.test.ts src/tenant/__tests__/schema.test.ts src/db/__tests__/auth-schema.test.ts src/db/__tests__/plan-schema.test.ts src/db/__tests__/workout-plan-schema.test.ts src/db/__tests__/workout-tracking-schema.test.ts src/db/__tests__/user-profile-schema.test.ts src/db/__tests__/user-preferences-schema.test.ts src/db/__tests__/vector-memory-schema.test.ts` → 58 files / 829 tests passed | ✅ `pnpm --filter api test -- src/db/__tests__/billing-schema.test.ts src/db/repositories/__tests__/billing-backfill.test.ts src/tenant/__tests__/provisioning.test.ts` → RED with missing `0011_billing_plans_tiers.sql`, missing `billing-backfill.js`, and provisioning trial assertions failing | ✅ Same focused command after implementation → 60 files / 845 tests passed | ✅ Added boundary-date trial case, concurrent backfill rerun, missing tenant id fail-closed, composite FK/index assertions, and provisioning trial insert assertions | ✅ Extracted `buildTrialBillingState` / `buildBackfillBillingState`; kept provisioning thin |
| 1.2 | same files | Unit | ✅ Same baseline | ✅ Schema/provisioning tests written first before table/migration code | ✅ Focused suite green after schema, migration, provisioning, CLI, and package wiring | ✅ Trial system source + backfill free source covered with separate scenarios | ✅ Shared helper reused by provisioning + backfill CLI |
| 1.3 | same files | Unit | ✅ Same baseline | ✅ Added uniqueness/FK/non-negative/idempotency/audit/migration assertions before final schema polish | ✅ Focused suite green and repo quality gates passed | ✅ Rerun backfill (`missing=0 inserted=0 skippedExisting=0`) plus runtime provisioned-trial row proved later-slice foundations | ✅ Billing DTOs added in `@kinora/contracts` without Stripe/provider leakage |

## Test Summary

- **Total tests written**: 28 new/expanded assertions across billing schema, backfill, and provisioning coverage
- **Total tests passing**: Focused command passed with 845/845 tests in the current API Vitest invocation
- **Layers used**: Unit (primary), runtime migration/backfill harness (bounded integration proof)
- **Approval tests**: None — additive slice
- **Pure functions created**: 2 (`buildTrialBillingState`, `buildBackfillBillingState`)

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm --filter api test -- src/db/__tests__/billing-schema.test.ts src/db/repositories/__tests__/billing-backfill.test.ts src/tenant/__tests__/provisioning.test.ts` → **PASS** (`Test Files 60 passed`, `Tests 845 passed`) |
| Runtime harness command/scenario and exact result | `podman run pgvector/pgvector:pg17` → `DATABASE_URL=postgres://kinora:kinora@localhost:55432/kinora pnpm --filter api db:migrate` → `pnpm --filter api exec tsx --eval "... provisionTenantForUser ..."` → insert tenant → `pnpm --filter api db:backfill-billing-plans` twice → `select tenant_id, tier, status, source, trial_started_at is not null, trial_ends_at is not null from tenant_billing_states` → **PASS**. Output showed one `system` `pro/trialing` tenant with both trial timestamps present and one `backfill` `free/active` tenant with both trial timestamps absent. Second backfill rerun reported `missing=0 inserted=0 skippedExisting=0`. |
| Rollback boundary | Revert `apps/api/src/db/schema.ts`, `apps/api/drizzle/0011_billing_plans_tiers.sql`, `apps/api/drizzle/meta/_journal.json`, `apps/api/src/db/repositories/billing-backfill.ts`, `apps/api/src/db/backfill-billing-plans.ts`, `apps/api/src/tenant/provisioning.ts`, `apps/api/package.json`, `packages/contracts/src/index.ts`, and the new billing tests. This removes Slice 1 schema/backfill foundations without touching later billing gates/UI/payment work. |

## Completed Tasks

- [x] 1.1 RED — Added failing billing schema/backfill/provisioning tests before production code.
- [x] 1.2 GREEN — Added billing persistence schema + migration + provisioning trial insert + backfill CLI/foundation.
- [x] 1.3 TRIANGLE — Proved composite membership FKs, uniqueness, non-negative checks, idempotent reruns, boundary dates, and contract DTO exposure.

## Files Changed

| File | Action | What changed |
|------|--------|--------------|
| `apps/api/src/db/schema.ts` | Modified | Added billing enums, tenant billing state/override tables, tenant/member quota tables, ledger, and audit persistence schema with checks/indexes/FKs. |
| `apps/api/drizzle/0011_billing_plans_tiers.sql` | Created | Added additive billing migration with enums, tables, constraints, and indexes. |
| `apps/api/drizzle/meta/_journal.json` | Modified | Registered migration `0011_billing_plans_tiers`. |
| `apps/api/src/db/repositories/billing-backfill.ts` | Created | Added safe idempotent tenant billing backfill + pure trial/backfill row builders. |
| `apps/api/src/db/backfill-billing-plans.ts` | Created | Added runtime CLI for bounded backfill execution. |
| `apps/api/src/tenant/provisioning.ts` | Modified | Provisioned tenant-owned 30-day Pro trial on tenant creation. |
| `apps/api/package.json` | Modified | Added `db:backfill-billing-plans` runtime script. |
| `packages/contracts/src/index.ts` | Modified | Added billing DTOs/enums/denial contracts without Stripe/payment fields. |
| `apps/api/src/db/__tests__/billing-schema.test.ts` | Created | Added schema + migration assertions for Slice 1 billing persistence. |
| `apps/api/src/db/repositories/__tests__/billing-backfill.test.ts` | Created | Added backfill/trial helper/idempotency/fail-closed tests. |
| `apps/api/src/tenant/__tests__/provisioning.test.ts` | Modified | Added tenant trial provisioning assertions. |
| `openspec/changes/11a-billing-plans-tiers/tasks.md` | Modified | Marked Slice 1 tasks complete. |

## Verification Results

- `pnpm type-check` → **PASS**
- `pnpm architecture` → **PASS**
- `pnpm deps-guard` → **PASS**
- `pnpm build` → **PASS**
- Podman bounded migration/backfill/provisioning harness → **PASS**

## Deviations from Design

None — implementation matches the approved Slice 1 design boundary.

## Issues Found

- Vitest's current CLI invocation still collected the broader API suite when running focused paths, so the recorded focused command passed as `60` files / `845` tests instead of only the three touched files. The command remains the smallest existing repo command that proved this slice without switching test tooling.

## Remaining Tasks

- [ ] 2.1 RED: Add failing tests for hybrid tenant quotas and gating.
- [ ] 2.2 GREEN: Implement billing core use cases and gates.
- [ ] 2.3 TRIANGLE: Prove atomic consume, retry idempotency, and denial fail-closed behavior.
- [ ] 3.1–4.3 Quota admin API, web UI, final verify/rollout.

## Workload / PR Boundary

- **Mode**: stacked PR slice
- **Current work unit**: Unit 1 — Billing schema/backfill + contract DTOs
- **Boundary**: Starts at persistence/contracts foundations and ends before any entitlement use case, AI gate, admin API, web UI, Stripe, or payment behavior.
- **Estimated review budget impact**: Slice stays inside the planned PR1 boundary by limiting changes to schema, migration, contracts, provisioning, backfill, and proof only.

---

# Apply Progress: 11a-billing-plans-tiers — Slice 2

**Batch**: Slice 2 / Phase 2 — entitlement, atomic hybrid quota consume, generation + retrieval gating
**Delivery**: chained PR slice (`stacked-to-main`), stacked on Slice 1 (commit `78ec793`)
**Mode**: Strict TDD
**Status**: Slice 2 complete — Phase 2 tasks 2.1, 2.2, 2.3 are `[x]`

---

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `apps/api/src/billing/__tests__/entitlement.test.ts`, `apps/api/src/billing/__tests__/quota-consumption.test.ts`, `apps/api/src/routes/__tests__/plan-generation.test.ts` (Generation metering gate), `apps/api/src/ai/__tests__/generation-service.memory.test.ts` (entitlement skip) | Unit | ✅ Full API suite `pnpm --filter api test` baseline (850 pre-existing tests) | ✅ First run → **6 failed / 850 passed**; billing use-case modules unresolved + route gate + retrieval-skip tests failing (`expected 403 to be 202`, `undefined checkAndConsume.mock.calls`, retrieval not skipped) | ✅ After implementation → **875/875 tests passed** | ✅ Boundary/expiry trial cases, override precedence, member-vs-tenant exhaustion, concurrency race, idempotent replay, empty-key rejection, denied-skip + allowed-retrieve | ✅ Extracted pure `resolveEffectiveTier` / `resolveTenantFeatureLimit` / `currentBillingPeriod`; kept use cases port-only |
| 2.2 | same files | Unit | ✅ Same baseline | ✅ Tests referenced not-yet-existing `billing/*` modules and un-wired gates | ✅ Implemented `billing/{types,plan-limits,entitlement,quota-consumption}.ts` + infra adapters `db/repositories/billing-quota.ts`; wired `plan.ts` gate, `generation-service.ts` + `memory-retriever.ts` retrieval gate, `app.ts` composition → suite green | ✅ Gate proven active at route (deny → 403, no generation) and retrieval (deny → skip, no embedding/search) | ✅ Pure use cases depend only on ports; Drizzle isolated to `db/` for architecture guard |
| 2.3 | `apps/api/src/billing/__tests__/quota-consumption.test.ts` | Unit | ✅ Same baseline | ✅ Atomic/race/idempotency/empty-key/fail-closed assertions written before consume logic | ✅ `FakeLedger` (atomic critical section modelling `SELECT FOR UPDATE` + conditional `UPDATE ... WHERE used < limit`) proves invariants; production `QuotaLedgerRepository` mirrors the same transaction contract | ✅ All-or-nothing (member cap denial leaves tenant counter untouched), exactly-one-success race, replay-without-double-consume, empty-key never touches ledger, entitlement denial never consumes | ✅ Consume orchestration kept in use case; DB atomicity in the repository transaction |

## Test Summary

- **Total tests written**: 26 new assertions (8 entitlement, 7 quota-consumption, 5 route metering gate, 2 generation retrieval gate + reuse of existing memory suite, 4 effective-tier)
- **Total tests passing**: `875/875` in the API Vitest invocation (was 850 before this slice)
- **Layers used**: Unit (primary) + fake-port atomicity/concurrency model; real Drizzle adapter covered by runtime harness
- **Approval tests**: None — additive slice
- **Pure functions created**: 3 (`resolveEffectiveTier`, `resolveTenantFeatureLimit`, `currentBillingPeriod`)

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm --filter api test -- src/billing/__tests__/entitlement.test.ts src/routes/__tests__/plan-generation.test.ts src/routes/__tests__/user-memories.test.ts` → **PASS** (`Test Files 62 passed`, `Tests 875 passed`). Note: Vitest still collects the full API suite for positional paths (same known behaviour recorded in Slice 1). |
| Runtime harness command/scenario and exact result | N/A for this executor run — the real Drizzle `QuotaLedgerRepository` (`SELECT FOR UPDATE` + conditional increments) and `BillingStateReaderRepository` require a live Postgres, deferred to the Phase 4/verify runtime smoke (`pnpm --filter api dev` + confirm/regen deny-allow + memory-write deny/allow). Unit-level atomicity/concurrency/idempotency is fully proven via the faithful `FakeLedger` (synchronous atomic critical section models the DB transaction). |
| Rollback boundary | Delete `apps/api/src/billing/*` and `apps/api/src/db/repositories/billing-quota.ts`; revert the gate wiring in `apps/api/src/routes/plan.ts`, `apps/api/src/ai/generation-service.ts`, `apps/api/src/ai/memory-retriever.ts`, and `apps/api/src/app.ts`; drop the new/expanded tests. This removes all entitlement/consume gating and restores Slice 1 (schema/backfill) behaviour with inert billing tables — no admin API, web UI, or payment work is touched. |

## Completed Tasks

- [x] 2.1 RED — Added failing tests for hybrid quotas, generation metering, idempotent retry, empty operation key, and denied-entitlement-skips-retrieval.
- [x] 2.2 GREEN — Implemented `billing/*` use cases + infra adapters and wired gates into plan route, generation service, memory retriever, and composition root.
- [x] 2.3 TRIANGLE — Proved atomic tenant+member consume, concurrency race safety, retry idempotency, empty-key rejection, and fail-closed denial (no generation/retrieval on deny).

## Files Changed

| File | Action | What changed |
|------|--------|--------------|
| `apps/api/src/billing/types.ts` | Created | Pure billing types (`BillingScope`, `EntitlementDecision`, `ConsumeDecision`) re-exporting contract denial reasons/tiers. |
| `apps/api/src/billing/plan-limits.ts` | Created | Pure Free/Pro feature-limit resolution + `currentBillingPeriod` (UTC `YYYY-MM`). |
| `apps/api/src/billing/entitlement.ts` | Created | `CheckEntitlement` use case + pure `resolveEffectiveTier` (override precedence, trial-expiry boundary, premium/limit-0 gating, fail-closed membership/billing checks). |
| `apps/api/src/billing/quota-consumption.ts` | Created | `CheckAndConsumeQuota` use case + `QuotaLedgerPort` (empty-key rejection, entitlement short-circuit, replay/consume/deny mapping). |
| `apps/api/src/db/repositories/billing-quota.ts` | Created | Drizzle adapters: `BillingStateReaderRepository` (membership/state/active-override) + `QuotaLedgerRepository` (single-transaction idempotency + membership re-check + `SELECT FOR UPDATE` all-or-nothing tenant/member increments + ledger). |
| `apps/api/src/routes/plan.ts` | Modified | Added optional `PlanBillingGate`; confirm consumes `plan_generation`, regenerate consumes `plan_regeneration`; denial → 403 with reason; operation key from `Idempotency-Key` header or deterministic/fresh fallback. |
| `apps/api/src/ai/memory-retriever.ts` | Modified | Added `MemoryRetrievalEntitlementPort` (product gate contract for premium retrieval). |
| `apps/api/src/ai/generation-service.ts` | Modified | Added optional `memoryEntitlement`; `attachMemoryContext` skips retrieval before embedding/search on denial (fail-open only after allow). |
| `apps/api/src/app.ts` | Modified | Composed billing repos + use cases; wired route gate and memory-retrieval entitlement. |
| `apps/api/src/billing/__tests__/entitlement.test.ts` | Created | Effective-tier + entitlement decision tests. |
| `apps/api/src/billing/__tests__/quota-consumption.test.ts` | Created | Atomic consume / race / idempotency / empty-key / fail-closed tests with faithful `FakeLedger`. |
| `apps/api/src/routes/__tests__/plan-generation.test.ts` | Modified | Added generation-metering gate tests (allow/deny confirm+regenerate, operation-key shape). |
| `apps/api/src/ai/__tests__/generation-service.memory.test.ts` | Modified | Added denied-skips-retrieval + allowed-retrieves tests. |
| `openspec/changes/11a-billing-plans-tiers/tasks.md` | Modified | Marked Phase 2 tasks complete. |

## Verification Results

- `pnpm --filter api test` (full API suite) → **PASS** (`Test Files 62 passed`, `Tests 875 passed`)
- `pnpm type-check` → **PASS** (all 6 workspaces)
- `pnpm deps-guard` → **PASS**
- `pnpm architecture` → **PASS** (`no dependency violations found`, negative guard passed)
- `pnpm build` → **PASS**

## Deviations from Design

- The design's File Changes table places billing under `apps/api/src/billing/*`. The Drizzle-backed adapters were placed in `apps/api/src/db/repositories/billing-quota.ts` instead, because `.dependency-cruiser.cjs` (`api-no-db-outside-infra`) forbids importing `drizzle-orm`/`pg` outside `apps/api/src/db/` and `apps/api/src/tenant/`. The pure use cases remain under `apps/api/src/billing/` and depend only on ports. This satisfies the architecture guard without changing the design's layering intent.
- Route billing gate is `optional` (test seam) rather than a hard-required DI throw. Production (`app.ts`) always injects it, so production fails closed; the optionality only preserves existing wizard tests that do not exercise generation gating.
- Pro tier uses a provisional finite aggregate cap (`PRO_FEATURE_LIMIT = 1_000_000`) since 11a is provider-independent and does not define Pro pricing; exact Pro limits arrive in 11b. Free numeric limits match the spec exactly (gen 1, regen 1, memory 0).

## Issues Found

- ~~Mid-period tier downgrade (e.g., trial→free within the same calendar month) keeps the already-initialised tenant counter `limit` for that period~~ — **superseded**: this was a real CRITICAL defect (spec-violating), confirmed by 4R review and fixed in the "Slice 2 — Review Correction" section below.
- Same Vitest positional-path collection behaviour as Slice 1 (full suite runs for focused paths). Not a defect; recorded for transparency.

## Remaining Tasks

- [ ] 3.1–3.3 Quota admin API (owner/trainer allocation, privacy-safe usage DTOs, suspension/cross-tenant denial).
- [ ] 4.1–4.3 Web billing UI + i18n + final verify/rollout.

## Workload / PR Boundary

- **Mode**: stacked PR slice (PR2)
- **Current work unit**: Unit 2 — Entitlement, atomic consume, plan/memory gates
- **Boundary**: Starts after Slice 1 persistence/contracts and ends before the quota admin API (Phase 3), web UI (Phase 4), and any Stripe/payment work. No embeddings/vector-search implementation changed.
- **Estimated review budget impact**: New authored code ~700 lines (4 use-case files + 1 adapter + gate wiring) plus ~350 test lines; within the planned PR2 slice.

---

# Slice 2 — Review Correction

**Trigger**: 4R bounded review found two confirmed, refuter-verified CRITICAL defects in `apps/api/src/db/repositories/billing-quota.ts`.
**Mode**: Strict TDD (RED first — real-Postgres integration tests reproducing each defect against the pre-fix code, then GREEN).
**Scope**: Fix only these two defects + their tests. No Phase 3/4 work, no Stripe.

## Defects and Fixes

### CRITICAL 1 — Concurrent same-key double-consume

- **Root cause**: the idempotency replay `SELECT` ran BEFORE the tenant-counter `SELECT ... FOR UPDATE`. Two concurrent requests with the same `operationKey` both passed the replay check (neither saw the other's uncommitted ledger row), then serialized on the `FOR UPDATE` lock and BOTH incremented — violating spec `11a-v1-billing-plans-tiers` "neither counter is over-consumed" and "idempotent retry returns prior result without consuming again".
- **Fix**: reordered the transaction so the tenant-counter `INSERT ... ON CONFLICT DO NOTHING` + `SELECT ... FOR UPDATE` runs FIRST, and the idempotency replay lookup runs SECOND, now INSIDE the lock. A losing concurrent duplicate blocks on the lock until the winner commits, then observes the winner's committed ledger row and replays instead of double-consuming.

### CRITICAL 2 — Stale counter limit / mid-period tier downgrade bypass

- **Root cause**: the decision compared `tenantUsed` against the STORED counter `limit` column (fixed once at first insert via `tenantCounter?.limit ?? tenantLimit`), never the freshly resolved `tenantLimit` the caller (`CheckAndConsumeQuota`) recomputes from the CURRENT entitlement on every call. A tenant whose effective tier downgraded mid-period (e.g. trial expiry) kept the old, higher cap for the rest of the calendar month — violating the trial-expiry spec scenario ("Free limits apply" at/after `trial_ends_at`).
- **Fix**: the decision now compares `tenantUsed >= tenantLimit` (the fresh parameter) directly, never the stored column. The increment step additionally refreshes the stored `limit` to the resolved value — safe because the deny checks above already guarantee `used < limit` before that write, so the `used <= limit` / non-negative CHECK constraints cannot be violated.

## RED → GREEN Evidence

- **Test-fidelity gap addressed**: the existing `FakeLedger` (`billing/__tests__/quota-consumption.test.ts`) decided directly against the passed `tenantLimit` and had no real transaction/lock semantics, so it could not reproduce either defect. Per the coordinator's guidance, added a REAL integration suite against the actual `QuotaLedgerRepository`, using a fresh `podman run pgvector/pgvector:pg17` container (same pattern as the Slice 1 runtime harness) — **not** an improved fake — because both defects are transaction-ordering/lock bugs that only manifest against a real Postgres transaction.
- **New file**: `apps/api/src/db/repositories/__tests__/billing-quota.integration.test.ts`. Opt-in via `describe.skipIf(!process.env.DATABASE_URL)` so the default hermetic `vitest run` (no `DATABASE_URL`) skips it (3 tests reported as skipped) and CI stays unaffected; it only runs when a real Postgres is wired.
- **Harness**: `podman run -d -e POSTGRES_USER=kinora -e POSTGRES_PASSWORD=kinora -e POSTGRES_DB=kinora -p 55433:5432 docker.io/pgvector/pgvector:pg17` → `CREATE EXTENSION vector` → `DATABASE_URL=postgres://kinora:kinora@localhost:55433/kinora pnpm --filter api db:migrate` → tests seed a real tenant/user/active-membership row per test via Drizzle inserts.
- **RED** (against pre-fix code, `DATABASE_URL` set): `pnpm --filter api test -- src/db/repositories/__tests__/billing-quota.integration.test.ts` → **2 failed / 876 passed / 1 skipped (879)**.
  - CRITICAL 1 test: `expected [ 'consumed', 'consumed' ] to deeply equal [ 'consumed', 'replayed' ]` — both concurrent same-key requests incremented.
  - CRITICAL 2 test: `expected { outcome: 'consumed' } to deeply equal { outcome: 'denied', reason: 'tenant_quota_exhausted' }` — the second consume with a fresh, lower `tenantLimit` was wrongly allowed against the stale stored limit.
- **GREEN** (after fix, `DATABASE_URL` set): `pnpm --filter api test -- src/db/repositories/__tests__/billing-quota.integration.test.ts` → **63 files passed, 878 passed / 1 skipped (879)**.

## Full Verification (post-fix)

- Focused billing command — `pnpm --filter api test -- src/billing/__tests__/entitlement.test.ts src/billing/__tests__/quota-consumption.test.ts src/routes/__tests__/plan-generation.test.ts src/routes/__tests__/user-memories.test.ts` → **PASS** (`Test Files 63 passed`, `Tests 876 passed | 3 skipped (879)`, integration test correctly skipped without `DATABASE_URL`).
- Full API suite (hermetic, no `DATABASE_URL`) — `pnpm --filter api test` → **PASS** (`Test Files 63 passed`, `Tests 876 passed | 3 skipped (879)`).
- `pnpm type-check` → **PASS** (all 6 workspaces).
- `pnpm deps-guard` → **PASS**.
- `pnpm architecture` → **PASS** (`no dependency violations found`, negative guard passed).
- `pnpm build` → **PASS**.

## Files Changed

| File | Action | What changed |
|------|--------|--------------|
| `apps/api/src/db/repositories/billing-quota.ts` | Modified | Reordered `consume()` so the tenant-counter lock is acquired before the idempotency replay check (fixes CRITICAL 1); decision now compares against the freshly resolved `tenantLimit` instead of the stored counter `limit` column, and the increment step refreshes that stored limit (fixes CRITICAL 2). **68 changed lines** (42 insertions, 26 deletions — exact `git diff --no-index --stat` against the pre-fix version). |
| `apps/api/src/db/repositories/__tests__/billing-quota.integration.test.ts` | Created | Real-Postgres RED-then-GREEN reproduction of both defects (139 lines) — opt-in via `DATABASE_URL`, skipped hermetically. |

**Total changed-line count**: **68 lines** in the production fix (`billing-quota.ts`), well under the ~200-line correction budget. The new integration test file (139 lines, entirely additive RED-evidence) is test infrastructure, not production logic, and is called out separately per the budget's intent.

## Residual Risk

- The integration test requires a real Postgres (opt-in via `DATABASE_URL`); it is skipped in the default hermetic run and was NOT wired into any CI step in this correction (no CI config changed — out of scope for this bounded correction). Recommend a follow-up to run it in CI against a Postgres service container so this regression class is continuously guarded.
- Member-counter `limit` staleness is not spec-mandated to be re-resolved per call (member allocations are admin-set, not tier-derived), but the increment step was also updated to refresh the stored member-counter `limit` for consistency/hygiene; no spec scenario currently requires this and no regression was found there.
- The podman pgvector:pg17 container used for RED/GREEN evidence in this session was torn down after verification (`podman rm -f kinora-billing-fix-test`) — it is not left running.

## Completed Tasks (Correction)

- [x] RED — real-Postgres integration tests reproduce both CRITICAL defects against pre-fix code.
- [x] GREEN — both defects fixed; integration tests, focused billing command, full API suite, type-check, architecture, deps-guard, and build all pass.

---

## Second Bounded Correction — WARNING A + WARNING B

**Trigger**: the same 4R bounded review confirmed two WARNING findings (in addition to the two CRITICALs above).
**Mode**: Strict TDD, RED first — new tests were written, verified failing against the pre-fix code (via `git stash` isolating the production files), then the fixes were restored (`git stash pop`) for GREEN.
**Scope**: fix only these two findings + their tests. No Phase 3/4 work, no Stripe.

### WARNING A — Memory entitlement check outside the fail-open try/catch

- **Root cause**: `attachMemoryContext` awaited `memoryEntitlement.check()` OUTSIDE the `try/catch` that makes retrieval fail-open. A transient billing-table read error (thrown, not just `{allowed:false}`) propagated out of `attachMemoryContext` into `runGenerationTask`'s catch block, routing to `markFailed` — an optional premium-enhancement gate outage aborted the user's CORE plan generation.
- **Fix** (`apps/api/src/ai/generation-service.ts`): wrapped the `memoryEntitlement.check()` call in its own `try/catch`. A thrown/technical failure now logs a warning and returns the unmodified spec (skip retrieval, continue) — the same fail-open posture already applied to `retrieve()`. Only an explicit `{ allowed: false }` still logs the "skipped (entitlement denied)" info line; both paths converge on "continue without memory context," never on `markFailed`.

### WARNING B — Quota consumed before the spec is validated

- **Root cause**: `routes/plan.ts` ran `billing.checkAndConsume` (writing an `allowed` ledger row + incrementing the counter) BEFORE `generationService.startGeneration` validated the target spec. A confirm/regenerate against a nonexistent/unconfirmed/invalid `:id` still spent the unit even though `startGeneration` then threw `PlanSpecNotFoundError` (404) / `PlanSpecShapeError` (422) — on Free (limit 1) this locked the user out for the month with no plan ever generated.
- **Fix**: reordering, not compensation. Extracted the existing load+shape-validate steps of `startGeneration` into a private `loadValidatedSpec` helper (`apps/api/src/ai/generation-service.ts`) and exposed a new public `assertGeneratable(tenantId, userId, planSpecId)` that runs the same validation (same 404/422 errors) WITHOUT creating the generating row. `routes/plan.ts` now calls `generationService.assertGeneratable(...)` BEFORE `billing.checkAndConsume` in both the confirm and regenerate handlers — a validation failure returns 404/422 with the billing gate never invoked, so no unit is spent. The existing deny→403 and gate-error→500 behavior is unchanged; `startGeneration` still re-validates internally (a cheap duplicate `SELECT`, not the gated "expensive work" per design) so its own error semantics are untouched.

### RED → GREEN Evidence

- **RED** (pre-fix code, isolated via `git stash push -- apps/api/src/ai/generation-service.ts apps/api/src/routes/plan.ts`, keeping only the new tests active): `pnpm --filter api test -- src/routes/__tests__/plan-generation.test.ts src/ai/__tests__/generation-service.memory.test.ts` → **12 failed / 870 passed / 3 skipped (885)**. Failures reproduced exactly: `confirm: returns 404 ...` got `200`/`202` instead (quota consumed and generation started despite invalid spec), `calls assertGeneratable before checkAndConsume` saw an empty call order (method didn't exist yet), and the entitlement-throws memory test saw `markFailed` called instead of a completed generation.
- **GREEN** (after `git stash pop` restored the fixes): same command → **882 passed / 3 skipped (885)**, `Test Files 63 passed`.

### Full Verification (post-fix)

- Focused billing + plan-generation + generation-service — `pnpm --filter api test -- src/billing/__tests__/entitlement.test.ts src/billing/__tests__/quota-consumption.test.ts src/routes/__tests__/plan-generation.test.ts src/ai/__tests__/generation-service.memory.test.ts src/ai/__tests__/generation-service.test.ts` → **PASS** (`Test Files 63 passed`, `Tests 882 passed | 3 skipped (885)`).
- Full API suite — `pnpm --filter api test` → **PASS** (`Test Files 63 passed`, `Tests 882 passed | 3 skipped (885)`).
- `pnpm type-check` → **PASS** (all 6 workspaces).
- `pnpm deps-guard` → **PASS**.
- `pnpm architecture` → **PASS** (`no dependency violations found`, negative guard passed).
- `pnpm build` → **PASS**.

### Files Changed

| File | Action | What changed |
|------|--------|--------------|
| `apps/api/src/ai/generation-service.ts` | Modified | (A) `memoryEntitlement.check()` wrapped in try/catch — a thrown gate failure fails open (skip retrieval, continue) instead of propagating to `markFailed`. (B) Extracted `loadValidatedSpec` private helper from `startGeneration`; added public `assertGeneratable`. **69 changed lines** (53 insertions, 16 deletions — exact `git diff --no-index --stat` against the pre-this-correction snapshot). |
| `apps/api/src/routes/plan.ts` | Modified | `PlanRoutesOptions.generationService` now requires `assertGeneratable`; confirm and regenerate handlers call it BEFORE `billing.checkAndConsume`. **11 changed lines** (10 insertions, 1 deletion). |
| `apps/api/src/routes/__tests__/plan-generation.test.ts` | Modified | `buildMockGenerationService` gained an optional `validationError` param (models `assertGeneratable` rejecting); default test-app stub gained a no-op `assertGeneratable`; added 5 new tests (404/422 without consumption for confirm, 422 without consumption for regenerate, a prior-invalid-attempt-doesn't-block-a-later-valid-one test, and an explicit call-order assertion). |
| `apps/api/src/ai/__tests__/generation-service.memory.test.ts` | Modified | Added 1 new test: a thrown `memoryEntitlement.check()` still completes generation (`markReady`, not `markFailed`) with retrieval skipped. |

### Cumulative Changed-Line Count (both bounded corrections)

| Correction | File | Changed lines |
|---|---|---|
| CRITICAL 1 + 2 | `apps/api/src/db/repositories/billing-quota.ts` | 68 |
| WARNING A + B | `apps/api/src/ai/generation-service.ts` | 69 |
| WARNING B | `apps/api/src/routes/plan.ts` | 11 |
| **Total production correction** | | **148 lines** |

**148 / ~200-line budget** — under budget across BOTH bounded corrections combined. (Test-file additions — `billing-quota.integration.test.ts` 139 lines, plus the additive test blocks in `plan-generation.test.ts` and `generation-service.memory.test.ts` — are RED evidence/test infrastructure and are called out separately from the production-fix budget, consistent with the first correction's reporting.)

### Residual Risk

- `assertGeneratable` and `startGeneration` both call `specRepo.findConfirmedById` — a harmless duplicate read on the happy path (not the gated "expensive work": no `workout_plans` row, no provider call, no embedding/search happens twice). No correctness or idempotency impact; flagged for awareness only.
- The fail-open catch around `memoryEntitlement.check()` means a persistently failing billing-table read will silently and repeatedly skip premium retrieval without surfacing an alert beyond the `console.warn` line already used elsewhere in this file — consistent with the existing `retrieve()` fail-open posture, not a new gap.
- No CI/observability changes were made in this bounded correction (out of scope).

### Completed Tasks (Second Correction)

- [x] RED — new tests reproduce both WARNING findings against pre-fix code (isolated via `git stash`).
- [x] GREEN — both fixes applied; focused tests, full API suite, type-check, architecture, deps-guard, and build all pass; cumulative correction changed-line count (148) confirmed under the 200-line budget.

---

## Judgment Day — Round 1 Correction

Two authorized findings fixed under Strict TDD (RED → GREEN). Branch `feat/11a-billing-plans-tiers-slice2`, HEAD `d49a26c`, PR #167. No commit/push performed.

### FIX 1 (CRITICAL) — Premium `memory_write` was entirely ungated

**Defect**: `POST /user-memories` called `UserMemoryLifecycleService.createConfirmed` with NO billing gate. The `memoryEntitlement` gate was wired only into `PlanGenerationService` retrieval (`memory_retrieval`), never the write path. A Free-tier tenant (`memory_write=0`), an expired-trial tenant, or a suspended member could store a vector memory and incur embedding-provider cost with no entitlement/quota check — directly violating the spec scenarios "Expired trial blocks premium memory write" and "Suspended membership blocks memory write".

**Fix**: Injected a `MemoryBillingGate` into the write route (mirrors `PlanBillingGate`). `POST /user-memories` now calls `checkAndConsume(scope, "memory_write", operationKey)` AFTER body-shape validation and BEFORE `createConfirmed` (which owns embed + store), so a denial creates no row and triggers no embedding. Denial → HTTP 403 `{ error: <reason> }`. A gate technical error propagates (→ 500) rather than being swallowed — the write path fails CLOSED. Wired through the `app.ts` composition root against the shared `checkAndConsumeQuota`.

- **operationKey strategy**: prefer the `Idempotency-Key` header; deterministic fallback `memory_write:${body.idempotencyKey}`. The request already carries a required non-empty `idempotencyKey`, so a re-confirm of the same fact consumes at most one `memory_write` unit — consistent with the confirm route's deterministic-key contract.
- **Files**: `apps/api/src/routes/user-memories.ts` (gate + `MemoryBillingGate` type + `resolveOperationKey`), `apps/api/src/app.ts` (composition-root wiring).
- **RED**: `apps/api/src/routes/__tests__/user-memories.test.ts` — 5 new failing assertions (Free 403 + no embed/row; expired-trial 403; suspended fail-closed 403; gate-throws → 500 fail-closed; entitled Pro write succeeds). RED output: `expected 200 to be 403` ×3, `expected 200 to be 500`, `spy called 0 times`.
- **GREEN**: `pnpm --filter api test src/routes/__tests__/user-memories.test.ts` → 45 passed.

### FIX 2 (WARNING) — Cached capacity-exhaustion denial locked out a later-entitled retry

**Defect**: `QuotaLedgerRepository.consume` persisted `denied` ledger rows for `tenant_quota_exhausted` / `member_allocation_exhausted`, and the in-transaction idempotency re-check replayed ANY prior row. Under the deterministic confirm key `plan_generation:<id>`, a mid-period upgrade/override could not clear the stale 403 — the retry replayed the old denial for the rest of the period.

**Fix**: Capacity-exhaustion denials are TRANSIENT (they reflect current period usage vs. currently-resolved limit, both of which change mid-period) and consume nothing, so they are no longer written to the idempotency ledger. A same-key retry after an upgrade is re-evaluated against current entitlement/quota. Terminal `inactive_membership` denials remain persisted/sticky (fail-closed), as authorized. The two proven invariants are preserved: (i) a concurrent duplicate of an ALLOWED consume still replays exactly once (allowed rows are still written), and (ii) empty-key rejection and fail-closed membership checks are untouched.

- **Files**: `apps/api/src/db/repositories/billing-quota.ts` (drop `writeLedger` for the two capacity denials).
- **RED**: `apps/api/src/db/repositories/__tests__/billing-quota.integration.test.ts` — new real-Postgres test: Free exhausts `plan_generation` on spec A, spec B denied, upgrade to Pro, same-key retry of spec B. RED output: `expected 'replayed' to be 'consumed'`. Companion hermetic unit test added in `apps/api/src/billing/__tests__/quota-consumption.test.ts` (FakeLedger kept faithful to production).
- **GREEN**: integration suite → 4 passed / 1 skipped (incl. both preserved invariants: concurrent same-key exactly-once, mid-period downgrade denial); `quota-consumption.test.ts` → 8 passed.

### Gate results (post-fix)

- Full API suite (`pnpm --filter api test`, `DATABASE_URL` wired to pgvector:pg17): **891 passed, 1 skipped**.
- `pnpm type-check`: **pass** (6 projects). `pnpm architecture`: **pass** (no violations; negative guard passed). `pnpm deps-guard`: **pass**. `pnpm build`: **pass**.

### Changed-line count

Production: `user-memories.ts` +56/-3, `app.ts` +10/-1, `billing-quota.ts` +11/-2 = ~76 changed production lines. Including tests + `tasks.md`: ~292 insertions across 7 files. Both fixes are independently reversible (route/app wiring for FIX 1; a single ledger-adapter change for FIX 2).

---

## Judgment Day — Round 2 Correction

Round-1 re-judgment (both judges) confirmed FIX 1 and FIX 2 RESOLVED, and found ONE fix-caused WARNING (corroborated by both judges). Fixed here under Strict TDD (RED → GREEN). No commit/push.

### FIX (fix-caused WARNING) — `memory_write` was consumed before eligibility/enabled/store

**Defect (introduced by Round-1 FIX 1)**: the Round-1 gate ran in the POST route BEFORE `createConfirmed`. Eligibility classification (422), disabled-settings (409), and embed/store all happen INSIDE `createConfirmed`, AFTER the consume. So a Pro tenant submitting ineligible content or with memory disabled consumed a `memory_write` unit that stored nothing; because the operation key is deterministic, a retry replayed `allowed` and the unit stayed spent.

**Fix**: Moved the gate OUT of the route and INTO `UserMemoryLifecycleService.createConfirmed`, injected via the service constructor. The consume now runs AFTER the eligibility + enabled checks pass and JUST BEFORE `writer.saveConfirmedMemory` (the embed+store step). A denial returns a new `{ kind: "denied"; reason }` outcome that the route maps to the same 403. A gate technical error propagates (→ 500): the write still fails CLOSED. The operation key remains deterministic (`memory_write:${idempotencyKey}`), built inside the service (the HTTP `Idempotency-Key` header override was dropped — the service is HTTP-agnostic and the body key already gives at-most-once consume).

**Consume placement chosen**: single-phase, consume-before-embed (the delegate's preferred approach). This is REQUIRED by the Round-1 CRITICAL invariant — consuming before embedding is the only way to guarantee a Free/expired/suspended/exhausted tenant never triggers embedding cost. Consequence: a provider/store failure has already consumed the reserved unit. This is a deliberate, documented cost tradeoff and is self-healing: the deterministic key makes a same-fact retry REPLAY the prior `allowed` decision (no second consume) and complete the store, so at most one unit is ever consumed per fact; only a fact that fails embedding AND is never retried leaves one unit spent. The alternative (entitlement-check pre-embed + consume post-store) was rejected because a concurrent capacity race could store a row while "denying", which is a worse regression against the CRITICAL no-row-on-denial guarantee.

- **Error-precedence change (expected/accepted)**: a Free tenant submitting ineligible content now returns 422 (eligibility) rather than 403 (billing), because eligibility precedes the consume. Tests assert this ordering.
- **Files**: `apps/api/src/user-memory/service.ts` (+48: `MemoryWriteBillingGate` port, `denied` outcome + audit outcome, constructor gate, consume call), `apps/api/src/routes/user-memories.ts` (removed route gate/`MemoryBillingGate`/`resolveOperationKey`; added `kind === "denied"` → 403), `apps/api/src/app.ts` (gate moved from route registration to service constructor). ~66 net changed production lines (round-2 delta; the route is now leaner than round-1).
- **RED**: `apps/api/src/routes/__tests__/user-memories.test.ts` — new tests: (1) Pro + ineligible → 422 and `checkAndConsume` NOT called; (2) Pro + disabled → 409 and NOT called. Both RED against the route-gated code (`checkAndConsume` was called once). Store-failure guard: consume runs exactly once before the failed store → 503.
- **GREEN**: `pnpm --filter api test src/routes/__tests__/user-memories.test.ts` → 48 passed (incl. preserved Round-1 regressions: Free/expired-trial/suspended still denied 403 before embedding with no row; entitled eligible write still succeeds and consumes exactly once).

### Hard-constraint verification (no regressions)

- CRITICAL still resolved: entitlement/quota denial returns before `saveConfirmedMemory`, so no embedding and no `vector_memory` row for Free (limit 0) / expired-trial / suspended-membership. Verified by the Round-1 tests (still green) plus the new placement (consume is immediately before embed).
- Fail-closed on gate technical error preserved (throw → 500, before embed/store).
- Deterministic operation key preserved → same-fact retry consumes at most once; a rejected/ineligible/disabled write now consumes NOTHING, so its retry is re-evaluated (not replayed).
- Round-1 FIX 2 (capacity-denial non-persistence) and `billing-quota.ts` consume/idempotency/limit logic untouched.

### Gate results (post-fix)

- Full API suite (`DATABASE_URL` → pgvector:pg17): **894 passed, 1 skipped**.
- `pnpm type-check`: **pass**. `pnpm architecture`: **pass** (service→`billing/types` import allowed by the guard). `pnpm deps-guard`: **pass**. `pnpm build`: **pass**.

### Residual risk

- Documented single-unit reservation on an abandoned embed/store failure (self-healing on retry via the deterministic key). Accepted for the cost-safety reason above.
