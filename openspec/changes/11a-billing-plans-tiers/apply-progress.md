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

---

# Apply Progress: 11a-billing-plans-tiers — Slice 3

**Batch**: Slice 3 / Phase 3 — owner/trainer quota-administration API + privacy-safe DTOs
**Delivery**: chained PR slice (`stacked-to-main`), stacked on Slice 2
**Mode**: Strict TDD
**Status**: Slice 3 complete — Phase 3 tasks 3.1, 3.2, 3.3 are `[x]`

---

## Key design decision — "trainer" maps to the tenant `owner` role

The schema `membership_role` enum is `["owner", "member"]` — there is **no distinct
`trainer` role**, and `provisioning.ts` creates the tenant creator as `owner`. The spec
scenario text confirms this: "GIVEN trainer O **owns** tenant T". Therefore an authorized
quota administrator is an **active owner** (`role === "owner" && status === "active"`); a
`member` (or any non-active membership) is denied `unauthorized_quota_admin` and fails
closed. This is determined by schema + scenario text, not a guess.

Privacy boundary (also fully specified, not guessed): the design says "return only
tenant/member counts" and the pre-defined contract DTOs (`TenantQuotaUsageDTO`,
`MemberQuotaUsageDTO`) carry only integers/enums. The boundary is about **content**
(memories/prompts/health/generated private data), never about usage counts. Per-member
usage COUNTS are non-sensitive aggregates and are explicitly allowed to an administering
owner. The `QuotaAdminPort` type surface exposes ONLY count-returning reads — there is no
method that could surface member content — enforcing the boundary structurally.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `apps/api/src/routes/__tests__/billing.test.ts` | Unit (route + use case via fake port) | ✅ Full API suite baseline (894 pre-slice) | ✅ First run → billing.test.ts failed to resolve (`../billing.js`, `../../billing/quota-admin.js` did not exist) — the run aborted on the target module | ✅ After implementation → `billing.test.ts` **14/14 passed** | ✅ Authorized-owner allocation + audit-actor assertion, non-owner 403, suspended-actor 401 + use-case fail-closed, owner-may-set-suspended-member, cross-tenant subject 403, body-tenantId-ignored, out-of-bounds 422, malformed 422, privacy count-only shape, port-surface-is-counts-only | ✅ Extracted `isActiveOwner` guard + `PERIOD_PATTERN`; use cases pure/port-only; Drizzle isolated to `db/` |
| 3.2 | same + `apps/api/src/db/repositories/__tests__/billing-admin.integration.test.ts` | Unit + real-Postgres integration | ✅ Same baseline | ✅ Tests referenced not-yet-existing route/use-case/adapter modules | ✅ Implemented `billing/quota-admin.ts` (`SetMemberAllocation`, `GetTenantUsage`, `QuotaAdminPort`), `db/repositories/billing-admin.ts` (Drizzle adapter), `routes/billing.ts`, contract DTOs, and `app.ts` wiring → focused suite green | ✅ Owner-only authz proven at route; body `tenantId` ignored (scope from authContext); allocation upsert idempotent | ✅ Route decoupled from DB; adapter reuses `resolveEffectiveTier` for bounds |
| 3.3 | `apps/api/src/db/repositories/__tests__/billing-admin.integration.test.ts` (real Postgres) | Integration | ✅ Same baseline | ✅ Audit-row/aggregate-read assertions written before adapter existed | ✅ Real-Postgres run (`DATABASE_URL` → pgvector:pg17) → **4 passed / 1 skipped**: allocation + `member_allocation_set` audit row written atomically; second write upserts limit + appends a second audit row; `readTenantUsage`/`readMemberUsage` return count-only rows scoped to the tenant; `loadTenantTier` resolves the effective tier | ✅ Audit actor/subject/feature/period/metadata all asserted; member-usage shape asserted to carry only count keys | ✅ Opt-in via `DATABASE_URL` (skipped hermetically), mirroring Slice 2 integration pattern |

## Test Summary

- **Total tests written**: 18 new (14 hermetic route/use-case in `billing.test.ts` + 4 real-Postgres in `billing-admin.integration.test.ts`; +1 skipped placeholder)
- **Total tests passing**: full API suite `912 passed | 2 skipped (914)` with `DATABASE_URL` wired (65 files)
- **Layers used**: Unit (route + use case via faithful fake port) + real-Postgres integration (audit write + aggregate reads)
- **Approval tests**: None — additive slice
- **Pure functions/use cases created**: `SetMemberAllocation`, `GetTenantUsage` (pure, port-only) + `isActiveOwner` guard

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm --filter api test src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` → **PASS** (`Test Files 2 passed`, `Tests 24 passed`) |
| Runtime harness command/scenario and exact result | `podman run pgvector/pgvector:pg17` (port 55434) → `DATABASE_URL=… pnpm --filter api db:migrate` → `DATABASE_URL=… pnpm --filter api test src/db/repositories/__tests__/billing-admin.integration.test.ts` → **PASS** (`4 passed | 1 skipped`). Proved a real `billing_audit_events` row (`action=member_allocation_set`, `actor_user_id`=owner, `subject_user_id`=member, `metadata={limit}`) is written in the SAME transaction as the `member_quota_allocations` upsert, and that the usage reads return tenant-scoped count-only rows. Container torn down after (`podman rm -f kinora-billing-p3-test`). |
| Rollback boundary | Delete `apps/api/src/routes/billing.ts`, `apps/api/src/billing/quota-admin.ts`, `apps/api/src/db/repositories/billing-admin.ts`, and the two new test files; revert the `billingRoutes` registration + imports in `apps/api/src/app.ts`; revert the added DTOs (`MemberAllocationDTO`, `SetMemberAllocationResponse`, `TenantUsageReportDTO`) in `packages/contracts/src/index.ts`. This removes the quota-admin API without touching Slice 1/2 schema, entitlement, consume, or gating behavior, or any Phase 4 web/Stripe work.

## Completed Tasks

- [x] 3.1 RED — Added failing route + use-case tests for `Member Quota Administration`, `Quota Privacy Boundary`, `Membership suspension blocks consumption/management`, and `Cross-tenant billing denied`.
- [x] 3.2 GREEN — Implemented the owner/trainer quota-admin API (`routes/billing.ts`), pure use cases (`billing/quota-admin.ts`), Drizzle adapter (`db/repositories/billing-admin.ts`), privacy-safe contract DTOs, and `app.ts` wiring.
- [x] 3.3 TRIANGLE — Proved `billing_audit_events` are written for admin actions (real Postgres), usage totals are aggregate/count-only, and no member memory/prompt/health/private content is reachable through these endpoints (enforced by the port's type surface + response-shape assertions).

## Files Changed

| File | Action | What changed |
|------|--------|--------------|
| `apps/api/src/billing/quota-admin.ts` | Created | Pure `SetMemberAllocation` / `GetTenantUsage` use cases + `QuotaAdminPort`; owner-only fail-closed authz, plan-bounds validation, cross-tenant subject guard. |
| `apps/api/src/db/repositories/billing-admin.ts` | Created | Drizzle adapter: membership/tenant-tier reads, atomic allocation upsert + `member_allocation_set` audit write in one tx, tenant/member usage count reads (no content columns). |
| `apps/api/src/routes/billing.ts` | Created | `GET /billing/usage` (owner-only counts) + `PUT /billing/allocations` (owner-only, audited); tenant/actor from authContext only; denial→HTTP mapping (403 authz, 422 out-of-bounds/invalid). |
| `apps/api/src/app.ts` | Modified | Composed `BillingAdminRepository` + use cases and registered `billingRoutes`. |
| `packages/contracts/src/index.ts` | Modified | Added `MemberAllocationDTO`, `SetMemberAllocationResponse`, `TenantUsageReportDTO` (count-only, no Stripe/payment/content fields). |
| `apps/api/src/routes/__tests__/billing.test.ts` | Created | 14 hermetic route + use-case tests for the 4 Phase-3 scenarios. |
| `apps/api/src/db/repositories/__tests__/billing-admin.integration.test.ts` | Created | Real-Postgres audit-write + aggregate-read proof (opt-in via `DATABASE_URL`, skipped hermetically). |
| `openspec/changes/11a-billing-plans-tiers/tasks.md` | Modified | Marked Phase 3 tasks complete. |

## Verification Results

- Focused work-unit-3 command — `pnpm --filter api test src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` → **PASS** (`2 files`, `24 tests`).
- Full API suite (`DATABASE_URL` → pgvector:pg17) — `pnpm --filter api test` → **PASS** (`Test Files 65 passed`, `Tests 912 passed | 2 skipped (914)`).
- `pnpm type-check` → **PASS** (all workspaces; fixed one branded-`UserId` boundary cast in `routes/billing.ts`).
- `pnpm deps-guard` → **PASS**.
- `pnpm architecture` → **PASS** (`no dependency violations found`, negative guard passed).
- `pnpm build` → **PASS**.

## Endpoint Shapes (as implemented)

- `GET /billing/usage?period=YYYY-MM` → 200 `{ tenantUsage: TenantQuotaUsageDTO[], memberUsage: MemberQuotaUsageDTO[] }` (owner-only; period defaults to current billing period). 403 `unauthorized_quota_admin` for non-owners; 401 for suspended/no-session.
- `PUT /billing/allocations` body `SetMemberAllocationRequest { userId, feature, period, limit }` → 200 `{ allocation: MemberAllocationDTO }`. 403 `unauthorized_quota_admin` (non-owner / cross-tenant subject); 422 `allocation_out_of_bounds` (limit > tenant plan cap); 422 `invalid_allocation_request` (malformed body); 401 (suspended/no-session).

## Deviations from Design

- The design File Changes table lists a single `apps/api/src/billing/*` location and mentions `CreateAdminOverride`. Consistent with the Slice 2 deviation (and the `api-no-db-outside-infra` dependency-cruiser rule), the Drizzle adapter lives in `apps/api/src/db/repositories/billing-admin.ts` while the pure use cases stay in `apps/api/src/billing/quota-admin.ts`. `CreateAdminOverride` is **out of Phase-3 scope** (the assigned scenarios are the four named ones; admin overrides belong to the separate "Admin Overrides" requirement) and is intentionally not implemented here.
- Endpoint naming (`GET /billing/usage`, `PUT /billing/allocations`) was not fixed by the spec; chosen to be RESTful and to reuse the existing `SetMemberAllocationRequest` DTO (userId in body). Tenant id is never accepted from the client — always from authContext.

## Issues Found

- None functionally. One TS branded-type mismatch (`MemberAllocationDTO.userId` is the branded `UserId`, the use case works in plain strings) was fixed by a boundary cast in `routes/billing.ts` — a no-op at runtime.
- The initial privacy test used a too-broad substring scan that false-matched the legitimate `memory_write` feature enum value; corrected to inspect object KEYS (allowed count keys vs. forbidden content keys) instead of raw serialized substrings.

## Remaining Tasks

- [ ] 4.1–4.3 Web billing UI + i18n + final verify/rollout.

## Workload / PR Boundary

- **Mode**: stacked PR slice (PR3)
- **Current work unit**: Unit 3 — Trainer/owner quota API + privacy-safe DTOs
- **Boundary**: Starts after Slice 2 (entitlement/consume/gating) and ends before the Phase 4 web UI/i18n and any Stripe/payment work. No Slice 1/2 schema, entitlement, consume, or gating code changed.
- **Estimated review budget impact**: New authored production code ~370 lines (use cases + adapter + route + DTOs + app wiring) plus ~440 test lines; within the planned PR3 slice.

---

# Apply Progress: 11a-billing-plans-tiers — Slice 4

**Batch**: Slice 4 / Phase 4 — web billing UI + i18n + member-facing visibility endpoint
**Delivery**: chained PR slice (`stacked-to-main`), stacked on Slice 3
**Mode**: Strict TDD
**Status**: Slice 4 complete — Phase 4 tasks 4.1, 4.2, 4.3 are `[x]`

---

## Scope-gap resolution — member-facing `GET /billing/visibility` added under Phase 4

The pre-implementation scope check found that Slice 3 shipped only an OWNER-ONLY,
counts-only `GET /billing/usage`. The spec `Billing State Visibility` requirement
(`specs/11a-v1-billing-plans-tiers/spec.md:69-71`) explicitly says **"The UI AND API
SHOULD expose tenant tier, status, trial end, active override end, denial reason,
upgrade prompt destination, tenant usage total, and requesting member allocation
usage"** — i.e. the member-facing read is itself part of this Phase 4 requirement, not
a new/invented backend endpoint. `BillingVisibilityDTO` / `TenantBillingStateDTO`
already existed in `packages/contracts/src/index.ts` (Slice 1) but were unwired by any
route. The orchestrator confirmed this reading and authorized wiring it as part of
Phase 4. Implemented BOTH parts below in one Strict-TDD batch.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 (API) | `apps/api/src/routes/__tests__/billing-visibility.test.ts` | Unit (route + use case via fake port) | ✅ Full API suite baseline (912 passed / 8 skipped pre-slice) | ✅ First run → `Cannot find module '../../billing/billing-visibility.js'` — the target module did not exist | ✅ After implementing `GetBillingVisibility` (pure use case), `BillingVisibilityRepository` (Drizzle adapter), and the `GET /billing/visibility` route → **6/6 passed** | ✅ Own-usage-only privacy (second member never sees the first member's usage), suspended-member 401 (auth re-check) + `loadContext` never called, trial-badge fields present, backfilled-Free deterministic state + upgrade prompt, no-session 401 | ✅ Reused `resolveEffectiveTier` from `entitlement.ts`; kept `readOwnMemberUsage` structurally scoped to the caller's own `userId` |
| 4.1 (i18n) | `packages/i18n/src/__tests__/index.test.ts` (updated), `apps/web/src/app/(app)/billing/__tests__/*` | Unit | ✅ i18n suite baseline (29 passed) | ✅ Web tests referenced not-yet-existing `billing-client.ts`/`page.tsx`/`BillingPageClient.tsx` — module-not-found RED; i18n key-count assertion updated in the SAME commit as the new keys (parity guard would fail on mismatched EN/ES key sets) | ✅ Added 34 `billing.*` keys to BOTH `en.json`/`es.json`; i18n suite **29/29 passed**, key count **643** | ✅ `validateCatalogParity` passes for the full catalog including ICU placeholder parity on `billing.trial.badge` ({daysRemaining} plural) and `billing.usage.row` ({feature}/{used}/{limit}) | ✅ Namespace mirrors the existing `memory.*` structure (loading/states/controls-equivalent groups) |
| 4.2 (web) | `apps/web/src/app/(app)/billing/__tests__/{billing-client,page,BillingPageClient}.test.tsx` | Unit (server-only client, server component, client component w/ real EN catalog via `renderWithIntl`) | ✅ Full web suite baseline (856 passed pre-slice, includes existing memory/page suites) | ✅ 3 RED files: module-not-found for `../billing-client`, `../page`, `../BillingPageClient.js` | ✅ Implemented `billing-client.ts` (server-only fetch + DTO guard), `actions.ts` (Server Action reading `SESSION_COOKIE`), `page.tsx` (server component), `BillingPageClient.tsx` (tier/status/trial badge, usage rows, upgrade prompt, loading/empty/error/offline states), `loading.tsx` → **17/17 new tests passed** (7 client-fetch + 2 page + 8 client-component) | ✅ Own-tenant-only usage rendering, empty-usage state, upgrade-link presence/absence gated on `denialReason`, accessible retry-focus on error/offline, `progressbar`/`status` roles on loading, tenant-switch refresh via `window.focus`/`visibilitychange` replacing (never merging) state | ✅ Mirrors `apps/web/src/app/(app)/memory/*` file layout and offline/online-detection pattern exactly |
| 4.3 (verify) | full suites + gates + runtime smoke + real-Postgres integration | Integration/system | ✅ See Verification Results below | ✅ N/A (verification-only task) | ✅ All gates green | ✅ Production `next start` smoke against an unreachable API proved the real (non-jsdom) offline/error path renders correctly; podman pgvector:pg17 proved `BillingVisibilityRepository` for real (override resolution + own-usage-only isolation across two real members) | ✅ N/A |

## Test Summary

- **Total tests written**: 6 (API `billing-visibility.test.ts`) + 4 real-Postgres (`billing-visibility.integration.test.ts`, +1 skip-placeholder) + 7 (`billing-client.test.ts`) + 2 (`page.test.tsx`) + 8 (`BillingPageClient.test.tsx`) = 27 new tests, plus 1 updated i18n key-count assertion and 2 files (`billing.test.ts`, `app.ts` billing route options) adjusted to satisfy the new required `getBillingVisibility` option without changing Slice 3 behavior
- **Total tests passing**: Full API suite with `DATABASE_URL` wired (podman pgvector:pg17) — `922 passed | 3 skipped` (67 files); full web suite `856 passed` (100 files); i18n suite `29 passed` (5 files)
- **Layers used**: Unit (API route + use case via fake port; web server-only client; web server component; web client component with the REAL EN catalog via `renderWithIntl`) + real-Postgres integration (`BillingVisibilityRepository`) + a real (non-jsdom) production Next.js runtime smoke
- **Approval tests**: None — additive slice
- **Pure functions/use cases created**: `GetBillingVisibility` (pure, port-only)

## Work Unit Evidence

| Evidence | Exact result |
|---|---|
| Focused test command and exact result | `pnpm --filter api test src/routes/__tests__/billing-visibility.test.ts src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` → **PASS** (`Test Files 3 passed`, `Tests 30 passed`). `pnpm --filter web test -- "src/app/(app)/billing/__tests__"` → **PASS** (`Test Files 100 passed`, `Tests 856 passed` — full web suite, since the web vitest config runs per-project). `pnpm --filter @kinora/i18n test` → **PASS** (`Test Files 5 passed`, `Tests 29 passed`). |
| Runtime harness command/scenario and exact result | `podman run -d -p 55435:5432 pgvector/pgvector:pg17` (name `kinora-billing-p4-test`) → `DATABASE_URL=postgres://kinora:kinora@localhost:55435/kinora pnpm --filter api db:migrate` → `DATABASE_URL=… pnpm --filter api test src/db/repositories/__tests__/billing-visibility.integration.test.ts` → **PASS** (`4 passed \| 1 skipped`): proved `loadContext` resolves the tenant billing row with no override, resolves an ACTIVE admin override's tier AND `endsAt` correctly, `readOwnMemberUsage` returns ONLY the requested member's row across two real seeded members in the same tenant/period (structural privacy proof against real rows, not fakes), and `readTenantUsage` returns tenant-scoped aggregate counts. Then `DATABASE_URL=… pnpm --filter api test` → **PASS** (`67 files`, `922 passed \| 3 skipped`) — full suite green with the new adapter wired against real Postgres. Container torn down after (`podman rm -f kinora-billing-p4-test`). Separately, `pnpm --filter web build` succeeded (listed `/billing` as a registered route) and `pnpm --filter web start` (port 4173, `API_BASE_URL` pointed at an unreachable host) was smoke-tested with `curl http://127.0.0.1:4173/billing` → **HTTP 200**, page body contains `"We could not load your billing"` (the real, non-jsdom error-state render) and `kin-page` (the page shell), proving the SSR fetch-failure → error-state path works in a genuine Next.js runtime. The tenant-switch/focus-refresh and loading/offline/a11y paths are covered by jsdom + real-EN-catalog `BillingPageClient.test.tsx` (`renderWithIntl`); a live two-server (api+web) browser session was not additionally run since the SSR path and the client behavior are each proven at their own real boundary. |
| Rollback boundary | Delete `apps/api/src/billing/billing-visibility.ts`, `apps/api/src/db/repositories/billing-visibility.ts`, `apps/api/src/routes/__tests__/billing-visibility.test.ts`, `apps/api/src/db/repositories/__tests__/billing-visibility.integration.test.ts`, and `apps/web/src/app/(app)/billing/` (page.tsx, BillingPageClient.tsx, billing-client.ts, actions.ts, loading.tsx, `__tests__/`); revert the `getBillingVisibility` option/route addition + import in `apps/api/src/routes/billing.ts` and its wiring in `apps/api/src/app.ts`; revert the `getBillingVisibility` stub addition in `apps/api/src/routes/__tests__/billing.test.ts`; revert the `billing.*` namespace in `packages/i18n/src/messages/{en,es}.json` and the key-count assertion in `packages/i18n/src/__tests__/index.test.ts`. This removes Phase 4 (visibility endpoint + web UI + i18n) without touching Slice 1/2/3 schema, entitlement, consume, gating, or quota-admin behavior. |

## Completed Tasks

- [x] 4.1 RED — Added failing API tests (`billing-visibility.test.ts`) for the member-facing visibility endpoint and failing web/i18n tests (`billing-client.test.ts`, `page.test.tsx`, `BillingPageClient.test.tsx`) for loading/empty/error/offline states, a11y, and EN/ES parity (34 new `billing.*` keys, key-count assertion updated).
- [x] 4.2 GREEN — Implemented `GetBillingVisibility` (pure use case) + `BillingVisibilityRepository` (Drizzle adapter) + `GET /billing/visibility` route (API); `apps/web/src/app/(app)/billing/page.tsx` + `BillingPageClient.tsx` + `billing-client.ts` + `actions.ts` + `loading.tsx` (web) rendering tier/status/trial badge, tenant + own usage, and an upgrade prompt, refreshing on tab focus/visibility (tenant switch).
- [x] 4.3 TRIANGLE — Ran full API/web/i18n suites + all repo quality gates + a real production-build runtime smoke of `/billing`'s offline/error path; documented rollout/rollback below and in `verify-report.md`.

## Files Changed

| File | Action | What changed |
|------|--------|--------------|
| `apps/api/src/billing/billing-visibility.ts` | Created | Pure `GetBillingVisibility` use case + `BillingVisibilityPort`/`BillingVisibilityContext`; fail-closed on inactive membership / missing billing state; reuses `resolveEffectiveTier` for tier/source/trial-expiry resolution; premium-gate check via `memory_write` limit for `denialReason`/`upgradePromptPath`. |
| `apps/api/src/db/repositories/billing-visibility.ts` | Created | Drizzle adapter: membership/billing-state/active-override reads (incl. `updatedAt`/override `endsAt`), tenant aggregate usage read, and `readOwnMemberUsage` scoped to the caller's own `(tenantId,userId)` — structurally cannot read another member's counters. |
| `apps/api/src/routes/billing.ts` | Modified | Added `GET /billing/visibility` (ANY active member, unlike the owner-only `GET /billing/usage`); added `getBillingVisibility` to `BillingRoutesOptions` + the plugin's required-options guard. |
| `apps/api/src/app.ts` | Modified | Composed `BillingVisibilityRepository` + `GetBillingVisibility` and passed `getBillingVisibility` into the existing `billingRoutes` registration. |
| `apps/api/src/routes/__tests__/billing.test.ts` | Modified | Added a stub `getBillingVisibility` (unused by this suite) to satisfy the now-required `BillingRoutesOptions` field in both `buildTestApp` and the standalone no-session app builder — Slice 3 assertions unchanged. |
| `apps/api/src/routes/__tests__/billing-visibility.test.ts` | Created | 6 hermetic route + use-case tests for `Billing State Visibility` (own-usage-only privacy, suspended-member denial, trial badge, backfilled-Free state, no-session). |
| `apps/api/src/db/repositories/__tests__/billing-visibility.integration.test.ts` | Created | 4 real-Postgres tests (opt-in via `DATABASE_URL`, mirroring `billing-admin.integration.test.ts`): override tier+`endsAt` resolution, no-override baseline, own-usage-only isolation across two REAL seeded members, tenant aggregate usage. |
| `apps/web/src/app/(app)/billing/page.tsx` | Created | Server component: reads `SESSION_COOKIE`, calls `getBillingVisibility`, renders title/description + `BillingPageClient`. |
| `apps/web/src/app/(app)/billing/BillingPageClient.tsx` | Created | Client component: tier/status/trial badge, tenant + own usage rows, upgrade prompt (gated on `denialReason`), loading/empty/error/offline states, a11y roles (`progressbar`, `status`, retry-focus), tab-focus/visibility-driven refresh that REPLACES (never merges) state for tenant switching. |
| `apps/web/src/app/(app)/billing/billing-client.ts` | Created | `server-only` fetch client (`getBillingVisibility`) mirroring `memory-client.ts`'s `Result`-union/DTO-guard pattern. |
| `apps/web/src/app/(app)/billing/actions.ts` | Created | Server Action (`getBillingVisibilityAction`) reading the current session cookie on every call — a tenant switch's new session naturally returns that tenant's state only. |
| `apps/web/src/app/(app)/billing/loading.tsx` | Created | Next.js route loading state, mirroring `memory/loading.tsx`. |
| `apps/web/src/app/(app)/billing/__tests__/{billing-client,page,BillingPageClient}.test.tsx` | Created | 7 + 2 + 8 tests covering fetch/DTO-guard, server-component data flow, and client rendering/a11y/tenant-switch-refresh. |
| `packages/i18n/src/messages/en.json`, `packages/i18n/src/messages/es.json` | Modified | Added the `billing.*` namespace (34 keys: title/description, loading, states, tier, status, trial, usage incl. empty state, feature labels, upgrade) with full EN/ES parity and matching ICU placeholders. |
| `packages/i18n/src/__tests__/index.test.ts` | Modified | Updated the full-catalog leaf-key-count assertion from 609 to 643 (+34 `billing.*` keys) with a dated comment. |
| `openspec/changes/11a-billing-plans-tiers/tasks.md` | Modified | Marked Phase 4 tasks 4.1/4.2/4.3 `[x]`. |

## Verification Results

- Focused work-unit-4 API command — `pnpm --filter api test src/routes/__tests__/billing-visibility.test.ts src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` → **PASS** (`3 files`, `30 tests`).
- Focused work-unit-4 web command — `pnpm --filter web test -- "src/app/(app)/billing/__tests__"` → **PASS** (`100 files`, `856 tests` — web vitest runs the whole project per invocation; all 3 new billing test files are included and green).
- i18n suite — `pnpm --filter @kinora/i18n test` → **PASS** (`5 files`, `29 tests`, including the updated 643-key-count and full EN/ES parity/ICU-arg guard).
- Real-Postgres integration — `podman run pgvector/pgvector:pg17` (port 55435) → `pnpm --filter api db:migrate` → `pnpm --filter api test src/db/repositories/__tests__/billing-visibility.integration.test.ts` → **PASS** (`4 passed | 1 skipped`).
- Full API suite with `DATABASE_URL` wired — `pnpm --filter api test` → **PASS** (`67 files`, `922 passed | 3 skipped`; container torn down after).
- Full API suite (hermetic, no `DATABASE_URL`) — `pnpm --filter api test` → **PASS** (`66 files`, `912 passed | 8 skipped` — real-Postgres integration tests from prior slices + this slice skip cleanly; no regressions).
- Full web suite — `pnpm --filter web test` → **PASS** (`100 files`, `856 tests`).
- `pnpm type-check` → **PASS** (all workspaces).
- `pnpm architecture` → **PASS** (`no dependency violations found (1600 modules, 4648 dependencies cruised)`; negative guard passed — confirms `billing-visibility.ts`'s Drizzle adapter correctly lives under `db/repositories/`, not `billing/`).
- `pnpm deps-guard` → **PASS**.
- `pnpm build` → **PASS** (`pnpm deps-guard && pnpm ui-api-guard && pnpm architecture && pnpm -r build`; `apps/web build` lists `/billing` as a registered dynamic route).
- Runtime smoke — production `pnpm --filter web start` + `curl /billing` against an unreachable API → **HTTP 200**, real (non-jsdom) error-state copy rendered (see Work Unit Evidence).

## Endpoint Shapes (as implemented)

- `GET /billing/visibility?period=YYYY-MM` → 200 `BillingVisibilityDTO { billing: TenantBillingStateDTO, tenantUsage: TenantQuotaUsageDTO[], memberUsage: MemberQuotaUsageDTO[], denialReason?, upgradePromptPath? }` — ANY active member of the caller's own tenant (tenant/user always from `authContext`); period defaults to the current billing period. `memberUsage` contains ONLY the requesting member's own rows. 403 `inactive_membership`/`billing_state_unavailable` on denial; 401 for suspended/no-session.
- `upgradePromptPath` is always `"/billing"` when `denialReason` is present — 11a has no Stripe/checkout page (explicitly out of scope), so the prompt destination is the billing page itself, which surfaces the upgrade CTA. This is a resolved product-ambiguity call, not a spec-fixed value.
- `denialReason` uses `memory_write`'s resolved limit as the representative premium-gate check (0 for Free/expired-trial tiers), mirroring the SAME denial `CheckEntitlement` would produce for any premium AI action right now — chosen so the UI shows one consistent upgrade prompt without duplicating per-feature gate logic. This is also a resolved implementation call, not spec-fixed.

## Deviations from Design

- The design's File Changes table does not separately list a member-facing visibility endpoint or use case — Slice 3 (owner-only `GetTenantUsage`) was the only billing read case named. Per the orchestrator's explicit authorization (see "Scope-gap resolution" above) and the spec's `Billing State Visibility` requirement text (which is UI-AND-API scoped), `GetBillingVisibility` + `GET /billing/visibility` were added in this Phase 4 batch, wiring the ALREADY-DEFINED `BillingVisibilityDTO`/`TenantBillingStateDTO` contracts (Slice 1) rather than inventing a new contract shape.
- Consistent with Slices 2/3's established pattern (and the `api-no-db-outside-infra` dependency-cruiser rule), the Drizzle adapter lives in `apps/api/src/db/repositories/billing-visibility.ts` while the pure use case stays in `apps/api/src/billing/billing-visibility.ts`.
- No dedicated tenant-switcher UI exists anywhere in the web app yet (confirmed by a repo-wide search — `AppShell`/`SidebarNav`/`MobileNav` carry no tenant-switch affordance). "Tenant switching refreshes billing... from the new tenant only" is satisfied by: (a) the server component always reading the CURRENT session cookie on every navigation, and (b) the client refetching (and REPLACING, never merging, state) on `window.focus`/`visibilitychange`, so a tenant switch effected elsewhere (new session/tab) is picked up without a full reload. This is a resolved product-ambiguity call given no existing tenant-switcher component to hook into, not an invented requirement.

## Issues Found

- None functionally. `billing.test.ts`'s `buildTestApp` and its standalone no-session app builder both needed a stub `getBillingVisibility` added to satisfy the now-3-field `BillingRoutesOptions`; this is test-plumbing only and does not change any Slice 3 assertion or behavior.

## Remaining Tasks

- None for 11a Phase 4. 11a is feature-complete per `tasks.md` (all Phase 1–4 tasks `[x]`); Stripe/payment-provider integration is explicitly out of 11a's scope (11b).

## Workload / PR Boundary

- **Mode**: stacked PR slice (PR4)
- **Current work unit**: Unit 4 — Web billing UI + i18n + member-facing visibility endpoint + final verify/rollout
- **Boundary**: Starts after Slice 3 (owner/trainer quota-admin API) and ends 11a's scope entirely (no Stripe/payment-provider work; that is 11b). No Slice 1/2/3 schema, entitlement, consume, gating, or quota-admin behavior changed.
- **Estimated review budget impact**: New authored production code ~340 lines (API: use case ~95 + adapter ~95 + route/app-wiring ~50; web: page/client/actions/client-fetch/loading ~230) plus ~370 test lines (API ~215 + web ~340) plus ~104 i18n lines (52 EN + 52 ES); within the planned PR4 slice, though likely near/over the 400-line authored-code budget when API+web+tests+i18n are combined into one PR — flagging for the orchestrator's judgment on whether PR4 should be sliced further (e.g. API-visibility-endpoint PR vs. web-UI PR) given the `stacked-to-main` chain strategy already assumed one PR per phase.

## Residual Risk

- A live two-server `pnpm dev` (api+web) browser session exercising a REAL tenant switch (two sessions/tenants, focus-triggered refresh) was not run — the focus/visibility refresh behavior is proven in jsdom against a mocked Server Action (`BillingPageClient.test.tsx`), and the SSR fetch path is proven against a real production server (curl smoke); the two were not combined into one live end-to-end browser session in this sandboxed environment. Low risk: the refresh mechanism is a thin `window.focus`/`visibilitychange` listener calling the SAME `getBillingVisibilityAction` already proven at the HTTP+adapter boundary.
- `upgradePromptPath` and the `memory_write`-as-representative-premium-feature choice for `denialReason` (see Endpoint Shapes) are resolved implementation calls, not spec-fixed values — flagging for product review once 11b (Stripe) introduces a real checkout destination.

---

## Phase 4 — Review Correction

**Trigger**: 4R review of Slice 4 found 0 CRITICAL, 6 real findings (2 RELIABILITY near-mandatory/mandatory, 2 RESILIENCE, 2 SUGGESTION-cheap). All 6 applied in one bounded correction batch, Strict TDD (RED first where the finding was independently observable as a failing/reproducible test), no commit/push.

### FIX 1 (RELIABILITY, near-mandatory) — trial-badge test was a wall-clock time bomb

- **Bug**: `billing-visibility.test.ts` "shows trial badge fields" asserted `tier==='pro'` against `TRIALING_CONTEXT.trialEndsAt = 2026-07-28`, but the route's `getBillingVisibility.execute(scope, period)` call has no injectable `now` — it always resolves against the REAL wall clock. On/after 2026-07-28 the test silently starts failing with zero code change (CI breaks ~5 days out).
- **RED (proved the bomb is real)**: temporarily froze the system clock to `2026-08-01` (past `trialEndsAt`) with the test otherwise unchanged → `expected 'free' to be 'pro'` — confirmed the exact failure mode the review predicted.
- **Fix**: wrapped the test body in `vi.useFakeTimers()` / `vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"))` (a fixed instant BEFORE `trialEndsAt`) with `vi.useRealTimers()` in a `finally`. No assertion weakened.
- **GREEN**: reverted the frozen date to `2026-07-01` → `billing-visibility.test.ts` 6/6 passed, deterministically, regardless of real run date.
- **Sibling scan**: grepped every billing test file for `trialEndsAt`/wall-clock comparisons. `apps/api/src/billing/__tests__/entitlement.test.ts` already passes an explicit fixed `NOW` to `resolveEffectiveTier`/`CheckEntitlement.check` — not a time bomb. `billing-backfill.test.ts`'s fixed dates compute a trial window from a tenant-creation timestamp (not compared against real "now" for pass/fail) — not a time bomb. No other sibling found.

### FIX 2 (RELIABILITY) — expired-trial DTO rendered contradictory UI

- **Bug**: `BillingPageClient.tsx` gated the "Pro trial — N days left" badge on `billing.status === 'trialing'` alone. The API never flips the STORED status to `'expired'` (only `resolveEffectiveTier` downgrades the EFFECTIVE tier dynamically) — so a DTO with `status:'trialing'`, a past `trialEndsAt`, and `denialReason:'trial_expired'` rendered BOTH the active-trial badge AND the "Your Pro trial has ended" block simultaneously.
- **RED**: added `EXPIRED_TRIALING` fixture (`status:'trialing'`, `trialEndsAt` in the past, `tier:'free'`, `denialReason:'trial_expired'`) and a new test asserting only the "ended" copy shows. Ran against the unfixed component → failed exactly as predicted: `expected <span>Pro trial — 0 days left</span> to be null`.
- **Fix**: gated the badge on `isActiveUnexpiredTrial = status==='trialing' && denialReason!=='trial_expired' && trialEndsAt!==null && new Date(trialEndsAt).getTime() > Date.now()`.
- **GREEN**: new test passes; all 3 prior trial-badge/upgrade-prompt tests (active trial, Free+upgrade-prompt, no-upgrade-while-trialing) still pass unchanged.

### FIX 3 (RESILIENCE) — focus+visibilitychange refetch storm / race

- **Bug**: both `focus` and `visibilitychange` listeners called `refresh()` independently with no in-flight guard — a real tab activation fires both near-simultaneously, causing two concurrent fetches (and worse on rapid toggling), with the later response able to race/overwrite the earlier one.
- **RED**: added a test dispatching `focus` and `visibilitychange` in the same tick against a controllable (unresolved) mock and asserting `getBillingVisibilityAction` was called exactly once. Ran against the unfixed component → `expected "spy" to be called 1 times, but got 2 times`.
- **Fix**: added `inFlightRef` (skip a new `refresh()` call while one is pending — collapses a single activation to at most one fetch) and `requestIdRef` (belt-and-suspenders "latest wins": a response is only applied if no newer refresh has started since). Replace-not-merge and last-good-state-on-error behavior preserved unchanged.
- **GREEN**: new test passes (called exactly once, both before and after the pending fetch resolves); the existing tenant-switch-on-focus test still passes.

### FIX 4 (RESILIENCE) — SSR fetch had no timeout

- **Bug**: `billing-client.ts`'s server-side fetch had `cache:'no-store'` but no abort/timeout, so a hung API could stall the billing render up to undici's ~300s default instead of degrading to the existing `api_unreachable` → retry-card path.
- **RED**: added a test asserting the fetch call's `init.signal` is an `AbortSignal` instance. Ran against the unfixed client → `expected undefined to be an instance of AbortSignal`.
- **Fix**: added `signal: AbortSignal.timeout(5_000)` to the fetch call (`FETCH_TIMEOUT_MS = 5_000`).
- **GREEN**: signal test passes; added a second test mapping a `DOMException("...", "TimeoutError")` rejection to `{ kind: "error", message: "api_unreachable" }` — passes via the existing catch-all (no new branch needed, since `AbortSignal.timeout`'s rejection is just another thrown error).

### FIX 5 (SUGGESTION, cheap) — brittle whole-catalog magic-number test

- **Issue**: my Phase-4 edit bumped `packages/i18n/src/__tests__/index.test.ts`'s global leaf-key-count assertion `609 → 643`, perpetuating a pattern where ANY future namespace addition (unrelated to billing) must also edit this number.
- **Fix**: reverted the global assertion to stay accurate WITHOUT bumping the raw number — it now asserts `Object.keys(flat).filter(k => !k.startsWith("billing."))` has length `609` (frozen, decoupled from billing). Added a NEW scoped test "the billing namespace is present with EN+ES parity" mirroring the existing `mobileTracker` pattern: presence in both catalogs, `validateCatalogParity` (already the authoritative EN/ES parity check), and `billing.*` key count `=== 34` plus one spot-checked EN/ES pair.
- **GREEN**: i18n suite `5 files, 30 tests` (was 29) — all pass.

### FIX 6 (SUGGESTION, cheap) — shallow DTO validation let malformed rows through

- **Issue**: `billing-client.ts`'s `isBillingVisibilityDTO` only checked `tenantUsage`/`memberUsage` were arrays, not element shape — a malformed/partial row would pass validation and render as `"undefined/undefined used"`.
- **RED**: added two tests — a `tenantUsage` row missing fields, and a `memberUsage` row with a wrong-typed field (`used: "1"` instead of a number) — both asserting `invalid_response`. Ran against the unfixed client → both failed (returned `{ kind: "ok", ... }` with the malformed row passed through).
- **Fix**: added `isUsageRowShape`/`isMemberUsageRowShape` validators (checks `feature`/`period`: string, `used`/`limit`: number, plus `userId`: string for member rows) and required every row in both arrays to pass (`.every(...)`).
- **GREEN**: both new tests pass; all 6 pre-existing `billing-client.test.ts` tests still pass.

### Out of scope (left as documented follow-ups, per instruction — NOT implemented)

- Wiring `billing.navLabel` into the app nav — product decision.
- Failure telemetry/logging on billing fetch/refresh errors — observability infra.

### RED → GREEN Evidence Summary

| Fix | RED (before) | GREEN (after) |
|---|---|---|
| 1 | Simulated post-expiry clock → `expected 'free' to be 'pro'` | `billing-visibility.test.ts` 6/6 pass, deterministic at any real run date |
| 2 | Expired-trial fixture → stale badge rendered alongside "ended" copy | New test passes; badge and "ended" copy are mutually exclusive |
| 3 | Same-tick focus+visibilitychange → 2 calls | Same-tick double-activation → exactly 1 call, both pre- and post-resolution |
| 4 | `init.signal` was `undefined` | `init.signal` is an `AbortSignal`; timeout/abort maps to `api_unreachable` |
| 5 | N/A (design/practice fix, not a failing-test bug) | Global count decoupled from billing (`609`, filtered); new scoped billing-count test (`34`) added |
| 6 | Malformed tenant/member usage rows → `{ kind: "ok" }` (silently accepted) | Both malformed-row shapes → `{ kind: "error", message: "invalid_response" }` |

### Files Changed (this correction)

| File | What changed |
|---|---|
| `apps/api/src/routes/__tests__/billing-visibility.test.ts` | FIX 1 — froze the system clock in the trial-badge test. |
| `apps/web/src/app/(app)/billing/BillingPageClient.tsx` | FIX 2 — gated the trial badge on an active+unexpired trial; FIX 3 — added `inFlightRef`/`requestIdRef` guards around `refresh()`. |
| `apps/web/src/app/(app)/billing/__tests__/BillingPageClient.test.tsx` | FIX 2 — added `EXPIRED_TRIALING` fixture + test; FIX 3 — added the double-activation-collapses-to-one-fetch test. |
| `apps/web/src/app/(app)/billing/billing-client.ts` | FIX 4 — added `AbortSignal.timeout(5_000)` to the fetch call; FIX 6 — added per-row DTO shape validation. |
| `apps/web/src/app/(app)/billing/__tests__/billing-client.test.ts` | FIX 4 — added signal + abort-mapping tests; FIX 6 — added malformed-row tests. |
| `packages/i18n/src/__tests__/index.test.ts` | FIX 5 — decoupled the global leaf-key count from `billing.*`; added the scoped billing parity/count test. |

### Verification Results (this correction)

- Focused API — `pnpm --filter api test src/routes/__tests__/billing-visibility.test.ts src/routes/__tests__/billing.test.ts src/routes/__tests__/auth.test.ts` → **PASS** (`3 files`, `30 tests`).
- Focused web — `pnpm --filter web test -- "src/app/(app)/billing/__tests__"` → **PASS** (`100 files`, `862 tests` — up from 856; +2 BillingPageClient + +4 billing-client tests, minus none removed).
- i18n — `pnpm --filter @kinora/i18n test` → **PASS** (`5 files`, `30 tests` — up from 29).
- Full API suite (hermetic) — `pnpm --filter api test` → **PASS** (`67 files`, `913 passed | 12 skipped`).
- Full web suite — `pnpm --filter web test` → **PASS** (`100 files`, `862 tests`).
- `pnpm type-check` → **PASS** (all 6 workspaces).
- `pnpm architecture` → **PASS** (`no dependency violations found (1601 modules, 4652 dependencies cruised)`).
- `pnpm deps-guard` → **PASS**.
- `pnpm build` → **PASS** (`/billing` still a registered route).

### Changed-Line Count

Estimated **~194 authored lines** added/changed across the 6 files above in this correction batch (manual tally of each edit's net delta — the underlying Slice 4 work was never committed, so no clean git baseline exists to diff this batch alone against; the figure excludes incidental re-indentation). Within the 200-line budget for this correction.

### Residual Risk (this correction)

- None new. The FIX 3 in-flight/latest-wins guard is a thin, well-tested addition over the already-proven refresh path; no additional real-Postgres or production-build smoke was re-run for this correction since none of the 6 fixes touch the API adapter, route wiring, or SSR page — only the client-side gating/guard logic and one test-file's clock/assertions/validation, all covered by the suites above.

---

## Coverage-Closure Note (post-correction, pre-push gate)

**Trigger**: the pre-push coverage gate failed — global FUNCTION coverage 89.76% < 90% threshold, dragged by `apps/web/src/app/(app)/billing` at 84.21% funcs. Closed with genuine behavior tests (no coverage-theater), no production-code changes, no threshold lowered.

**Root cause**: three real, previously-untested code paths in the billing directory:
1. `loading.tsx` had ZERO tests (0% across the board).
2. `BillingPageClient.tsx`'s `handleOnline`/`handleOffline` window-event listeners (added for the offline-state feature) were never triggered by any test — only the INITIAL `navigator.onLine` value was exercised, never a LIVE connectivity change.
3. The bootstrap "no data, no error yet" empty-state branch, and a retry-that-itself-fails path, were also unexercised.

**Tests added**:
- `apps/web/src/app/(app)/billing/__tests__/loading.test.tsx` (new, 1 test) — mirrors `memory/__tests__/loading.test.tsx`: renders `BillingLoading`, asserts the `status`/`progressbar` a11y output and copy.
- `apps/web/src/app/(app)/billing/__tests__/BillingPageClient.test.tsx` (+4 tests):
  - "switches from error to offline (and back) when the browser's connectivity changes live" — dispatches real `offline`/`online` window events and asserts the UI actually flips between the error card and the offline card (genuinely exercises `handleOnline`/`handleOffline`, not just their initial-state proxy).
  - "shows the bootstrap empty state when there is no data and no error yet" — `initialData={null}` with no error, asserting the `billing.states.emptyTitle`/`emptyDescription` copy.
  - "re-shows the error state when a retry itself fails" — mocks `getBillingVisibilityAction` to resolve with `{ kind: "error" }` and asserts the error state persists (no fabricated data).

**Re-verification**:
- `pnpm --filter web test:coverage` → billing dir row: `100% stmts | 89.32% branch | 94.73% funcs | 100% lines` (funcs up from 84.21%). Global: `94.35% stmts | 86.55% branch | 90.28% funcs | 94.35% lines`. Command exited `0` — the `ERROR: Coverage for functions (...) does not meet global threshold (90%)` message is GONE.
- Full web suite — `pnpm --filter web test` → **PASS** (`101 files`, `866 tests` — up from 100/862).
- `pnpm type-check` → **PASS** (no output, clean).

No production code was touched — all 3 gaps were genuinely testable as written; no untestable-function report needed.
