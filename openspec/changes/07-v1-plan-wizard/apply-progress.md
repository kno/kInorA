# Apply Progress: 07-v1-plan-wizard — PR 1 + PR 2

**Batch**: PR 1 (first batch) + PR 2 (second batch)
**Branch PR 1**: `feat/07-plan-wizard-pr1-contracts-domain` (merged)
**Branch PR 2**: `feat/07-plan-wizard-pr2-api`
**Mode**: Strict TDD
**Status**: PR 1 Complete (merged) | PR 2 Complete — all tasks [x], 22/22 test files green, tsc clean monorepo-wide, migration applied and verified

---

## TDD Cycle Evidence

### PR 1 — Contracts + Domain

| Task | RED evidence | GREEN | REFACTOR |
|------|-------------|-------|----------|
| 1.1 Contract type test | `pnpm type-check` → TS2305 (PlanLimitation not found), TS2305 (PlanPreferenceScores not found), TS2344 (limitations[] mismatch) | Implement PlanLimitation + PlanPreferenceScores + update PlanSpec | none needed |
| 1.2 Implement contracts | — (implement step) | `pnpm --filter @kinora/contracts test` → 13/13 pass | — |
| 1.3 Verify contracts | `pnpm --filter @kinora/contracts type-check` → clean; update contracts.test.ts to match new shape | 13 tests + type-check clean | — |
| 2.1 derivePreferenceScores test | `pnpm --filter @kinora/domain test` → FAIL: Cannot find module '../derive-preference-scores.js' | Implement derive-preference-scores.ts | — |
| 2.2 Implement derivePreferenceScores | — (implement step) | 14/14 tests pass | — |
| 2.3 Verify domain | `pnpm --filter @kinora/domain type-check` → clean | 39 tests pass | — |
| 3.1 Update plan-draft tests | tsc errors: preferenceScores missing, limitations: string not assignable to PlanLimitation | Update plan-draft.test.ts with new shape + new assertions | — |
| 3.2 Update plan-draft fixtures | — (implement step: update test fixtures to use PlanLimitation[] and add preferenceScores) | 6 plan-draft tests pass | — |
| 3.3 Boundary test (RED) | `pnpm --filter api test` → 11 tests FAIL (assertPlanSpecShape not validating limitations objects or preferenceScores) | Implement updated assertPlanSpecShape | — |
| 3.4 Implement boundary | — (implement step) | 18/18 boundary tests pass; also fix legacy test/plan-spec-boundary.test.ts and apps/web/test/plan-spec-boundary.test.ts | — |
| 3.5 Verify all packages | `pnpm --filter @kinora/contracts type-check && pnpm --filter @kinora/domain type-check && pnpm --filter api type-check && pnpm --filter web type-check` → all clean | 176 api tests, 162 web tests, 39 domain tests, 13 contracts tests → all pass | — |

### PR 2 — API

| Task | RED evidence | GREEN | REFACTOR |
|------|-------------|-------|----------|
| 4.1 Plan schema tests (RED) | `pnpm --filter api test` → 14 FAIL: TypeError: Cannot read properties of undefined (planDrafts/planSpecs not exported from schema.ts) | Add planDrafts + planSpecs to schema.ts | — |
| 4.2 Implement schema tables | — (implement step) | 14/14 schema tests pass; 202 total | — |
| 4.3 Generate migration | `pnpm --filter api db:generate` → drizzle/0002_sharp_tag.sql generated | SQL correct (CREATE TABLE plan_drafts + plan_specs + unique index + FKs) | — |
| 4.4 Verify migration apply | podman run postgres:17-alpine → db:migrate → both tables + unique index confirmed; container removed | plan_drafts: id/tenant_id/user_id/step/spec_json/updated_at; plan_specs: id/tenant_id/user_id/spec_json/confirmed/created_at | — |
| 5.1 PlanDraftRepository tests (RED) | `pnpm --filter api test` → FAIL: Cannot find module '../plan-draft.js' | Create plan-draft.ts | — |
| 5.2 Implement PlanDraftRepository | — (implement step: upsert via onConflictDoUpdate, findCurrent, delete with and(tenantId,userId)) | 7/7 repo tests pass; 209 total | — |
| 5.3 PlanSpecRepository tests (RED) | `pnpm --filter api test` → FAIL: Cannot find module '../plan-spec.js' | Create plan-spec.ts | — |
| 5.4 Implement PlanSpecRepository | — (implement step: create with confirmed:true, returning id+spec) | 3/3 repo tests pass; 212 total | — |
| 5.5 Verify repositories | `pnpm --filter api test` → 212 passed (21 test files) | All passing | — |
| 6.1 Plan route tests (RED) | `pnpm --filter api test` → FAIL: Cannot find module '../plan.js' | Create plan.ts routes | — |
| 6.2 Implement plan routes | — (implement step: 3 routes with requireAuth, mock DB chain fix) | 11/11 route tests pass; 223 total | — |
| 6.3 Register planRoutes in app.ts | — (mechanical) | app.ts updated; all tests still pass | — |
| 6.4 Final verify | `pnpm --filter api test` → 223 passed (22 files); all 4 packages type-check clean | PR 2 complete | — |

---

## Completed PR 1 Tasks

- [x] 1.1 **TEST (RED)** — `packages/contracts/src/__tests__/plan-spec.test.ts`: type-level tests for PlanLimitation, PlanPreferenceScores, PlanSpec new shape
- [x] 1.2 **IMPLEMENT** — `packages/contracts/src/index.ts`: export PlanLimitation, PlanPreferenceScores; update PlanSpec (limitations: PlanLimitation[], add preferenceScores)
- [x] 1.3 **VERIFY** — contracts type-check clean; contracts.test.ts updated to new shape; 13 tests pass
- [x] 2.1 **TEST (RED)** — `packages/domain/src/plan/__tests__/derive-preference-scores.test.ts`: 14 table-driven tests covering all base cases, all modifiers, combined modifiers, clamping, rounding
- [x] 2.2 **IMPLEMENT** — `packages/domain/src/plan/derive-preference-scores.ts`: pure function with base table + modifiers + clamp/round; exported from index.ts
- [x] 2.3 **VERIFY** — 39 domain tests pass; type-check clean
- [x] 3.1 **TEST (RED)** — `packages/domain/src/__tests__/plan-draft.test.ts`: updated with PlanLimitation[], preferenceScores fixtures and assertions
- [x] 3.2 **IMPLEMENT** — `plan-draft.test.ts` fixtures updated; PlanDraft interface unchanged (extends PlanSpec which now has the new fields)
- [x] 3.3 **TEST (RED)** — `apps/api/src/plan/__tests__/boundary.test.ts`: 18 tests covering limitations object validation, preferenceScores validation, 08 coupling note; confirmed RED (11 failures before implementation)
- [x] 3.4 **IMPLEMENT** — `apps/api/src/plan/boundary.ts`: updated assertPlanSpecShape; atomic break consumers fixed: `apps/api/test/plan-spec-boundary.test.ts`, `apps/web/test/plan-spec-boundary.test.ts`
- [x] 3.5 **VERIFY** — All 4 packages type-check clean; all test suites green

## Completed PR 2 Tasks

- [x] 4.1 **TEST (RED)** — `apps/api/src/db/__tests__/plan-schema.test.ts`: 14 type assertions for planDrafts + planSpecs table schema shapes
- [x] 4.2 **IMPLEMENT** — `apps/api/src/db/schema.ts`: added planDrafts (uniqueIndex on tenant+user) + planSpecs (index on tenant+user)
- [x] 4.3 **GENERATE MIGRATION** — `drizzle/0002_sharp_tag.sql` + `drizzle/meta/_journal.json` + `drizzle/meta/0002_snapshot.json` generated via `pnpm --filter api db:generate`; committed together
- [x] 4.4 **VERIFY** — podman postgres:17-alpine on port 5433; `pnpm --filter api db:migrate` → both tables + unique index + FKs verified via `\d` commands; container removed
- [x] 5.1 **TEST (RED)** — `apps/api/src/db/repositories/__tests__/plan-draft.test.ts`: 7 tests (upsert single-active, findCurrent none/exists, delete, cross-tenant isolation)
- [x] 5.2 **IMPLEMENT** — `apps/api/src/db/repositories/plan-draft.ts`: PlanDraftRepository with upsert (onConflictDoUpdate), findCurrent (and clause), delete (and clause)
- [x] 5.3 **TEST (RED)** — `apps/api/src/db/repositories/__tests__/plan-spec.test.ts`: 3 tests (create returns {id,spec}, confirmed:true, cross-tenant)
- [x] 5.4 **IMPLEMENT** — `apps/api/src/db/repositories/plan-spec.ts`: PlanSpecRepository.create inserts with confirmed:true, returns {id, spec}
- [x] 5.5 **VERIFY** — `pnpm --filter api test` → 212 tests pass
- [x] 6.1 **TEST (RED)** — `apps/api/src/routes/__tests__/plan.test.ts`: 11 tests covering 401/upsert/single-active/204/draft-exists/409-no-draft/409-incomplete/201+delete/cross-tenant
- [x] 6.2 **IMPLEMENT** — `apps/api/src/routes/plan.ts`: planRoutes with requireAuth, 3 endpoints, assertPlanSpecShape+derivePreferenceScores at promote
- [x] 6.3 **IMPLEMENT** — `apps/api/src/app.ts`: registered planRoutes with db instance
- [x] 6.4 **VERIFY** — `pnpm --filter api test` → 223 tests pass (22 files); all 4 packages type-check clean

---

## Verification Results (verbatim)

### PR 1 Verification

#### `pnpm --filter @kinora/contracts test`
```
Test Files  2 passed (2)
Tests  13 passed (13)
```

#### `pnpm --filter @kinora/domain test`
```
Test Files  4 passed (4)
Tests  39 passed (39)
```

#### `pnpm --filter api test` (post PR 1)
```
Test Files  18 passed (18)
Tests  176 passed (176)
```

#### `pnpm --filter web test`
```
Test Files  31 passed (31)
Tests  162 passed (162)
```

### PR 2 Verification

#### `pnpm --filter api test` (final)
```
Test Files  22 passed (22)
Tests  223 passed (223)
```

#### All packages type-check
```
pnpm --filter @kinora/contracts type-check → 0 errors
pnpm --filter @kinora/domain type-check → 0 errors
pnpm --filter api type-check → 0 errors
pnpm --filter web type-check → 0 errors
```

#### Migration apply (podman postgres:17-alpine, port 5433)
```
pnpm --filter api db:migrate → [✓] migrations applied successfully!

\d plan_drafts:
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  tenant_id uuid NOT NULL (→ tenants ON DELETE CASCADE)
  user_id uuid NOT NULL (→ users ON DELETE CASCADE)
  step integer NOT NULL
  spec_json jsonb NOT NULL
  updated_at timestamptz NOT NULL DEFAULT now()
  UNIQUE INDEX: plan_drafts_tenant_user_unique (tenant_id, user_id)

\d plan_specs:
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  tenant_id uuid NOT NULL (→ tenants ON DELETE CASCADE)
  user_id uuid NOT NULL (→ users ON DELETE CASCADE)
  spec_json jsonb NOT NULL
  confirmed boolean NOT NULL DEFAULT false
  created_at timestamptz NOT NULL DEFAULT now()
  INDEX: plan_specs_tenant_user_idx (tenant_id, user_id)
```

---

## Files Changed — PR 1

| File | Action | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modified | Added PlanLimitation, PlanPreferenceScores interfaces; updated PlanSpec |
| `packages/contracts/src/contracts.test.ts` | Modified | Updated PlanSpec type assertion to new shape |
| `packages/contracts/src/__tests__/plan-spec.test.ts` | Created | Type-level test file |
| `packages/domain/src/plan/derive-preference-scores.ts` | Created | Pure derivePreferenceScores function |
| `packages/domain/src/plan/__tests__/derive-preference-scores.test.ts` | Created | 14 table-driven tests |
| `packages/domain/src/index.ts` | Modified | Export derivePreferenceScores |
| `packages/domain/src/__tests__/plan-draft.test.ts` | Modified | Updated to new PlanSpec shape |
| `apps/api/src/plan/boundary.ts` | Modified | Updated assertPlanSpecShape |
| `apps/api/src/plan/__tests__/boundary.test.ts` | Created | 18-test suite |
| `apps/api/test/plan-spec-boundary.test.ts` | Modified | Updated fixtures |
| `apps/web/test/plan-spec-boundary.test.ts` | Modified | Updated fixtures |

## Files Changed — PR 2

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | Modified | Added planDrafts + planSpecs tables with indexes and FKs |
| `apps/api/src/db/__tests__/plan-schema.test.ts` | Created | 14 schema shape assertions |
| `apps/api/drizzle/0002_sharp_tag.sql` | Created | Generated migration — plan_drafts + plan_specs DDL |
| `apps/api/drizzle/meta/_journal.json` | Modified | Updated with 0002 entry |
| `apps/api/drizzle/meta/0002_snapshot.json` | Created | Drizzle schema snapshot after migration 0002 |
| `apps/api/src/db/repositories/plan-draft.ts` | Created | PlanDraftRepository (upsert, findCurrent, delete) |
| `apps/api/src/db/repositories/__tests__/plan-draft.test.ts` | Created | 7 repo tests |
| `apps/api/src/db/repositories/plan-spec.ts` | Created | PlanSpecRepository (create) |
| `apps/api/src/db/repositories/__tests__/plan-spec.test.ts` | Created | 3 repo tests |
| `apps/api/src/routes/plan.ts` | Created | planRoutes (3 endpoints) |
| `apps/api/src/routes/__tests__/plan.test.ts` | Created | 11 route integration tests |
| `apps/api/src/app.ts` | Modified | Registered planRoutes |

---

## Git Commits — PR 1 (work-unit order)

1. `feat(contracts): extend PlanSpec with PlanLimitation[] and PlanPreferenceScores`
2. `feat(domain): add derivePreferenceScores pure function`
3. `test(domain): update plan-draft fixtures for new PlanSpec shape`
4. `feat(api): update assertPlanSpecShape for PlanLimitation[] and preferenceScores`
5. `test(web): update plan payload fixture for new PlanSpec shape`

## Git Commits — PR 2 (work-unit order)

1. `feat(api): add plan_drafts and plan_specs tables to schema with migration` (9090aba)
2. `feat(api): add PlanDraftRepository and PlanSpecRepository` (a879940)
3. `feat(api): add plan wizard routes and register in app` (fad7bfe)

---

## PlanSpec Consumer Atomic Break — All Consumers Updated

| Consumer | File | Fix applied |
|----------|------|-------------|
| Contracts test | `packages/contracts/src/contracts.test.ts` | Added PlanLimitation[], PlanPreferenceScores to type assertion |
| Domain plan-draft test | `packages/domain/src/__tests__/plan-draft.test.ts` | PlanLimitation[] objects + preferenceScores in all fixtures |
| API boundary | `apps/api/src/plan/boundary.ts` | Validates new limitations + preferenceScores shape |
| API boundary test (legacy) | `apps/api/test/plan-spec-boundary.test.ts` | Added preferenceScores to all fixtures |
| Web boundary test | `apps/web/test/plan-spec-boundary.test.ts` | PlanLimitation[] + preferenceScores in all fixtures |

---

## Remaining (PR 3 — Web)

### PR 3 — Web (depends on PR 2 merged)
- [ ] 7.1–7.4 OrbitProgress component (SVG ring + ball + reduced-motion)
- [ ] 8.1–8.4 OrbitSelectableCard component
- [ ] 9.1–9.13 Six step components (GoalStep, LocationStep, FrequencyStep, DurationStep, EquipmentStep, LimitationsStep)
- [ ] 10.1–10.5 Stepper shell (StepperShell.tsx) + server actions (actions.ts) + page.tsx
- [ ] 11.1–11.2 E2E test (login → complete wizard → exit → resume → finish → plan_specs row exists)

---

## Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main)
- PR 1 work unit: Contracts + Domain (merged to main)
- PR 2 work unit: API — DB schema, migration, repositories, routes (current branch)
- PR 3 work unit: Web — Orbit components, wizard steps, stepper shell, server actions, E2E
- Estimated PR 2 review budget: ~320 changed lines (within 400-line budget for this slice)
