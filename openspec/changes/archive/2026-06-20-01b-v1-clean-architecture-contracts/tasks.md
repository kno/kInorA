# Tasks: 01b V1 Clean Architecture Contracts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr-default |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

Single PR. Commits map to phases. Work order: contracts → domain → enforcement → consumption → verification.

## Phase 1: Foundation — Shared Contracts (Req 2)

- [x] 1.1 Add `PlanGoal`, `TrainingLocation`, `PlanSpec` to `packages/contracts/src/index.ts` (verbatim from design.md). Verify `pnpm --filter @kinora/contracts type-check`. Structural type export — triangulation skipped.
- [x] 1.2 Add `"@kinora/contracts": "workspace:*"` to `apps/web/package.json` deps; `pnpm install`. Verify `pnpm --filter web type-check` resolves alias. Config/tooling.

## Phase 2: Domain Package (Req 3)

- [x] 2.1 Create `packages/domain/package.json` (name `@kinora/domain`; dep `@kinora/contracts` workspace:*; devDeps typescript + vitest 3.2.4; scripts `type-check`, `test: vitest run`). Verify `pnpm install` + `pnpm --filter @kinora/domain type-check` on empty src. Config/tooling.
- [x] 2.2 Create `packages/domain/tsconfig.json` (extends `../../tsconfig.base.json`, composite, rootDir `./src`) and `packages/domain/vitest.config.ts` (`globals: true`). Verify vitest loads with no tests.
- [x] 2.3 RED: Write `packages/domain/src/__tests__/plan-draft.test.ts` importing ONLY `@kinora/domain` + `@kinora/contracts`; call `createPlanDraft(spec)` (not yet implemented); assert draft echoes `goal`, `daysPerWeek`, `confirmed:false`. Run `pnpm --filter @kinora/domain test` → RED.
- [x] 2.4 GREEN: Implement trivial `packages/domain/src/plan/plan-draft.ts` `createPlanDraft(spec: PlanSpec)` → `{ ...spec, confirmed: false }`; create `src/index.ts` re-export. Run test → GREEN.
- [x] 2.5 Triangle: second case with different goal/location/equipment; assert passthrough + `confirmed` forced false; generalize if Fake-It breaks. Run → GREEN. (No infra/db import loaded = isolation proof.)
- [x] 2.6 Add `join(ROOT, "packages/domain/package.json")` to `WORKSPACE_PACKAGE_FILES` in `scripts/deps-guard.mjs`. Verify `pnpm deps-guard` lists domain and passes. Config/tooling.

## Phase 3: Architecture Enforcement (Req 1)

- [x] 3.1 Add `dependency-cruiser` root devDep + `.dependency-cruiser.cjs` (forbidden: `packages/domain/**` MUST NOT import `apps/**`, `packages/infra/**`, `next`, `react`, `fastify`, db/auth/payment/AI, node `net`/`http`); add root `architecture` script; wire root `build` to `pnpm deps-guard && pnpm architecture && pnpm -r build`. Verify `pnpm architecture` passes on clean tree. Config/tooling.
- [x] 3.2 RED: Add fixture `packages/domain/src/__arch_violation__.ts` importing `fastify`; run `pnpm architecture` → MUST fail with named layer-boundary error. RED.
- [x] 3.3 GREEN + Triangle: delete fixture; pass. Add relative-import fixture `from "../../../apps/api/src/index"` → confirm fails; delete; re-pass.

## Phase 4: Shared Contracts Consumption (Req 2 scenario)

- [x] 4.1 RED: Write `apps/api/test/plan-spec-boundary.test.ts` referencing not-yet-existing `assertPlanSpecShape(input)` from `apps/api/src/plan/boundary.ts`; assert accepts valid `PlanSpec`, rejects invalid. Run `pnpm --filter api test` → RED.
- [x] 4.2 GREEN: Implement minimal `assertPlanSpecShape` in `apps/api/src/plan/boundary.ts` typed with `PlanSpec` from `@kinora/contracts`. Run → GREEN.
- [x] 4.3 Triangle: invalid case (`confirmed` non-boolean) asserting different behavior; generalize. Run → GREEN.
- [x] 4.4 RED → GREEN → Triangle: Write `apps/web/test/plan-spec-boundary.test.ts` for `createPlanPayload(spec)` in `apps/web/src/lib/plan.ts` returning `PlanSpec` unchanged; implement + triangulate with second spec. Run `pnpm --filter web test`.

## Phase 5: Full Slice Verification

- [x] 5.1 Run `pnpm deps-guard && pnpm architecture && pnpm -r build && pnpm -r test` → all green. Proves all 3 spec requirements.