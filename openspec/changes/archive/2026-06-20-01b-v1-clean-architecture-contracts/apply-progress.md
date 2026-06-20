# Apply Progress: 01b-v1-clean-architecture-contracts

## Status: SUCCESS

All 16 tasks completed across 5 phases. Full gate passes.

## Phase 1: Foundation — Shared Contracts

- [x] 1.1 — Added `PlanGoal`, `TrainingLocation`, `PlanSpec` to `packages/contracts/src/index.ts`. Verified with `pnpm --filter @kinora/contracts type-check`.
- [x] 1.2 — Added `"@kinora/contracts": "workspace:*"` to `apps/web/package.json`. Verified with `pnpm install` + `pnpm --filter web type-check`.

## Phase 2: Domain Package

- [x] 2.1 — Created `packages/domain/package.json` (name `@kinora/domain`, deps/contracts, devDeps/typescript+vitest). Verified `pnpm install` + type-check.
- [x] 2.2 — Created `packages/domain/tsconfig.json` (extends base, composite, rootDir `./src`) and `vitest.config.ts` (globals: true).
- [x] 2.3 — RED: Wrote `packages/domain/src/__tests__/plan-draft.test.ts` importing `@kinora/domain` + `@kinora/contracts`. Test failed because `plan-draft` module didn't exist.
- [x] 2.4 — GREEN: Implemented `createPlanDraft(spec)` in `packages/domain/src/plan/plan-draft.ts`, created `src/index.ts` re-export. Tests pass (2/2).
- [x] 2.5 — TRIANGLE: Added second test case with different goal/location/equipment. All 3 tests pass. Isolation proof: no infra/db import loaded.
- [x] 2.6 — Added `packages/domain/package.json` to `WORKSPACE_PACKAGE_FILES` in `scripts/deps-guard.mjs`. Verified `pnpm deps-guard` passes.

## Phase 3: Architecture Enforcement

- [x] 3.1 — Added `dependency-cruiser` root devDep, `.dependency-cruiser.cjs` with 4 forbidden rules (`domain-no-outer-layers`, `domain-no-outer-npm-deps`, `domain-no-outer-npm-unresolvable`, `contracts-no-workspace-deps`). Wired `pnpm build` to `pnpm deps-guard && pnpm architecture && pnpm -r build`. Verified clean tree passes.
- [x] 3.2 — RED: Created `packages/domain/src/__arch_violation__.ts` importing `fastify`. `pnpm architecture` fails with `domain-no-outer-npm-unresolvable` error. Confirmed.
- [x] 3.3 — GREEN + TRIANGLE: Deleted fixture, passes. Added relative-import fixture `from "../../../apps/api/src/routes/health"`, fails with `domain-no-outer-layers` error. Deleted fixture, clean tree passes.

## Phase 4: Shared Contracts Consumption

- [x] 4.1 — RED: Wrote `apps/api/test/plan-spec-boundary.test.ts` referencing `assertPlanSpecShape` (not yet implemented). Tests fail.
- [x] 4.2 — GREEN: Implemented `assertPlanSpecShape` in `apps/api/src/plan/boundary.ts`. Tests pass (8/9 total).
- [x] 4.3 — TRIANGLE: Added test for `confirmed` as non-boolean string. Passes with specific error message. Tests pass (9/9 total).
- [x] 4.4 — RED → GREEN → TRIANGLE: Wrote `apps/web/test/plan-spec-boundary.test.ts` for `createPlanPayload(spec)`. Implement in `apps/web/src/lib/plan.ts`. Triangle with second spec. Tests pass (13/13 total).

## Phase 5: Full Slice Verification

- [x] 5.1 — `pnpm deps-guard && pnpm architecture && pnpm -r build && pnpm -r test` — ALL GREEN.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | N/A (type export) | N/A | ✅ contracts type-check | ➖ Structural | ➖ Structural | ➖ Triangulation skipped: single output type | ➖ None needed |
| 1.2 | N/A (config) | N/A | ✅ web type-check | ➖ Config | ➖ Config | ➖ Config | ➖ None needed |
| 2.1 | N/A (config) | N/A | ✅ domain type-check | ➖ Config | ➖ Config | ➖ Config | ➖ None needed |
| 2.2 | N/A (config) | N/A | ✅ vitest loads | ➖ Config | ➖ Config | ➖ Config | ➖ None needed |
| 2.3 | `packages/domain/src/__tests__/plan-draft.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed | ➖ (single before triangulation) | ➖ None needed |
| 2.4 | `packages/domain/src/__tests__/plan-draft.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed | ➖ (GREEN step) | ➖ None needed |
| 2.5 | `packages/domain/src/__tests__/plan-draft.test.ts` | Unit | ✅ 2/2 | ✅ Written | ✅ Passed | ✅ 3 cases | ✅ Clean |
| 2.6 | N/A (config) | N/A | ✅ deps-guard | ➖ Config | ➖ Config | ➖ Config | ➖ None needed |
| 3.1 | N/A (config) | N/A | ✅ architecture passes | ➖ Config | ✅ Passes | ➖ Config | ➖ None needed |
| 3.2 | Architecture (depcruise) | Architecture | N/A (new) | ✅ Fails with error | ✅ Deleted fixture | ➖ (single violation type) | ➖ None needed |
| 3.3 | Architecture (depcruise) | Architecture | ✅ Clean tree | ✅ Fails with error | ✅ Passes | ✅ Second violation type | ✅ Clean |
| 4.1 | `apps/api/test/plan-spec-boundary.test.ts` | Unit | ✅ 6/6 api tests | ✅ Written | ✅ Passed | ➖ (before triangle) | ➖ None needed |
| 4.2 | `apps/api/test/plan-spec-boundary.test.ts` | Unit | ✅ 6/6 api tests | ✅ Written | ✅ Passed | ➖ (before triangle) | ✅ Clean |
| 4.3 | `apps/api/test/plan-spec-boundary.test.ts` | Unit | ✅ 8/8 api tests | ✅ Written | ✅ Passed | ✅ 3 cases (valid + missing + non-boolean) | ✅ Clean |
| 4.4 | `apps/web/test/plan-spec-boundary.test.ts` | Unit | ✅ 11/11 web tests | ✅ Written | ✅ Passed | ✅ 2 cases (different spec) | ✅ Clean |
| 5.1 | Full gate | Integration | ✅ All gates | ✅ All pass | ✅ All pass | ➖ (verification) | ➖ None needed |

## Test Summary

- **Total tests written**: 8 new (3 domain + 3 api boundary + 2 web boundary)
- **Total tests passing**: 25 (3 domain + 9 api + 13 web)
- **Layers used**: Unit (8), Architecture (2 violations), Integration (1 full gate)
- **Approval tests** (refactoring): None — no refactoring tasks
- **Pure functions created**: 2 (`createPlanDraft`, `createPlanPayload`)

## Deviations from Design

- **dependency-cruiser config**: The design specified a single forbidden rule capturing both npm packages and relative imports. Implementation uses 3 rules (`domain-no-outer-layers` for relative paths + core modules, `domain-no-outer-npm-deps` for resolved npm packages in node_modules, `domain-no-outer-npm-unresolvable` for unresolvable npm imports like `fastify` from domain) plus `contracts-no-workspace-deps`. This was necessary because `to.path` patterns must match the actual resolved path format, which differs between relative imports and npm packages and unresolvable imports. The effect is the same: domain cannot import from outer layers.
- **Architecture RED test (3.2)**: The task specified importing `fastify` as the violation. Because `fastify` is not in domain's dependencies, dependency-cruiser reports it as an unresolvable module. The `domain-no-outer-npm-unresolvable` rule catches it by matching `couldNotResolve: true` combined with `pathNot: ["^@kinora/", "^\\."]` to exclude legitimate local and workspace imports.

## Issues Found

None.

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/contracts/src/index.ts` | Modified | Added `PlanGoal`, `TrainingLocation`, `PlanSpec` types |
| `apps/web/package.json` | Modified | Added `@kinora/contracts` workspace dependency |
| `packages/domain/package.json` | Created | New `@kinora/domain` package |
| `packages/domain/tsconfig.json` | Created | Extends base, composite, rootDir ./src |
| `packages/domain/vitest.config.ts` | Created | vitest config with globals: true |
| `packages/domain/src/index.ts` | Created | Re-exports `createPlanDraft`, `PlanDraft` |
| `packages/domain/src/plan/plan-draft.ts` | Created | Trivial use case: `createPlanDraft(spec)` → `{ ...spec, confirmed: false }` |
| `packages/domain/src/__tests__/plan-draft.test.ts` | Created | Isolation proof test (3 cases) |
| `scripts/deps-guard.mjs` | Modified | Added `packages/domain/package.json` to `WORKSPACE_PACKAGE_FILES` |
| `.dependency-cruiser.cjs` | Created | 4 forbidden rules for layer enforcement |
| `package.json` | Modified | Added `dependency-cruiser` devDep, `architecture` script, rewired `build` |
| `apps/api/src/plan/boundary.ts` | Created | `assertPlanSpecShape` structural validator |
| `apps/api/test/plan-spec-boundary.test.ts` | Created | 3 test cases for boundary |
| `apps/web/src/lib/plan.ts` | Created | `createPlanPayload` passthrough |
| `apps/web/test/plan-spec-boundary.test.ts` | Created | 2 test cases for payload |
| `pnpm-lock.yaml` | Modified | Lockfile updates |