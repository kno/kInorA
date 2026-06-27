# Apply Progress: 07-v1-plan-wizard — PR 1 (Contracts + Domain)

**Batch**: PR 1 (first batch)
**Branch**: `feat/07-plan-wizard-pr1-contracts-domain`
**Mode**: Strict TDD
**Status**: PR 1 Complete — 5/5 work-unit commits, all tests green, tsc green monorepo-wide

---

## TDD Cycle Evidence

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

---

## Verification Results (verbatim)

### `pnpm --filter @kinora/contracts test`
```
Test Files  2 passed (2)
Tests  13 passed (13)
```

### `pnpm --filter @kinora/domain test`
```
Test Files  4 passed (4)
Tests  39 passed (39)
```

### `pnpm --filter api test`
```
Test Files  18 passed (18)
Tests  176 passed (176)
```

### `pnpm --filter web test`
```
Test Files  31 passed (31)
Tests  162 passed (162)
```

### Per-package type-check
All four packages clean:
- `pnpm --filter @kinora/contracts type-check` → 0 errors
- `pnpm --filter @kinora/domain type-check` → 0 errors
- `pnpm --filter api type-check` → 0 errors
- `pnpm --filter web type-check` → 0 errors

---

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modified | Added PlanLimitation, PlanPreferenceScores interfaces; updated PlanSpec to use them |
| `packages/contracts/src/contracts.test.ts` | Modified | Updated PlanSpec type assertion to new shape; added PlanLimitation + PlanPreferenceScores imports and checks |
| `packages/contracts/src/__tests__/plan-spec.test.ts` | Created | Type-level test file for the new contract types |
| `packages/domain/src/plan/derive-preference-scores.ts` | Created | Pure derivePreferenceScores function per design §2 |
| `packages/domain/src/plan/__tests__/derive-preference-scores.test.ts` | Created | 14 table-driven tests for the function |
| `packages/domain/src/index.ts` | Modified | Export derivePreferenceScores |
| `packages/domain/src/__tests__/plan-draft.test.ts` | Modified | Updated to new PlanSpec shape; added location/limitations/preferenceScores assertions |
| `apps/api/src/plan/boundary.ts` | Modified | Updated assertPlanSpecShape for PlanLimitation[] + preferenceScores validation |
| `apps/api/src/plan/__tests__/boundary.test.ts` | Created | 18-test suite for updated assertPlanSpecShape |
| `apps/api/test/plan-spec-boundary.test.ts` | Modified | Updated fixtures to include preferenceScores (atomic break consumer fix) |
| `apps/web/test/plan-spec-boundary.test.ts` | Modified | Updated limitations to PlanLimitation[] and added preferenceScores (atomic break consumer fix) |

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

## Git Commits (work-unit order)

1. `feat(contracts): extend PlanSpec with PlanLimitation[] and PlanPreferenceScores`
2. `feat(domain): add derivePreferenceScores pure function`
3. `test(domain): update plan-draft fixtures for new PlanSpec shape`
4. `feat(api): update assertPlanSpecShape for PlanLimitation[] and preferenceScores`
5. `test(web): update plan payload fixture for new PlanSpec shape`

---

## Remaining (PR 2 + PR 3)

### PR 2 — API (depends on PR 1 merged)
- [ ] 4.1–4.4 DB schema + migration (plan_drafts, plan_specs tables)
- [ ] 5.1–5.5 Repositories (PlanDraftRepository, PlanSpecRepository)
- [ ] 6.1–6.4 Plan routes + register in app.ts

### PR 3 — Web (depends on PR 2 merged)
- [ ] 7.1–7.4 OrbitProgress component
- [ ] 8.1–8.4 OrbitSelectableCard component
- [ ] 9.1–9.13 Six step components
- [ ] 10.1–10.5 Stepper shell + server actions
- [ ] 11.1–11.2 E2E test

---

## Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main)
- Current work unit: PR 1 — Contracts + Domain
- Boundary: starts from clean main; ends with tsc green monorepo-wide and all tests passing
- Estimated review budget: ~240 changed lines (well within 400-line budget for this slice)
