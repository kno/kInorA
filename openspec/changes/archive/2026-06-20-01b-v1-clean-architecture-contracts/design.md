# Design: 01b V1 Clean Architecture Contracts

## Technical Approach

Create the inner contract and domain layers before feature code. `packages/contracts` remains the shared boundary package and exports `PlanSpec`; a new `packages/domain` depends only on contracts and proves use-case isolation with Vitest. Layer violations are enforced by a purpose-built static dependency check wired into root commands, while the existing capability guard stays responsible only for prohibited package categories.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Layer enforcement | Add `dependency-cruiser` at the root with `.dependency-cruiser.cjs` forbidden rules and a root `architecture` script. Root `build` runs `pnpm deps-guard && pnpm architecture && pnpm -r build`. | Extending `scripts/deps-guard.mjs`; `eslint-plugin-boundaries`. | `dependency-cruiser` is purpose-built for import graph rules and exits non-zero with a named forbidden-rule error when `packages/domain/**` imports infra/app/framework modules. Hand-rolled scanning is brittle for TS aliases and relative imports. ESLint would add ESLint plus plugin/config, too much scope for 01b. |
| Package layout | Add `packages/domain` as the inner use-case/domain package. Keep `packages/contracts` dependency-free. | Put domain inside `apps/api`; put contracts inside domain. | Domain must be reusable by API, web, and future mobile shell without framework coupling. Contracts are more stable and can be consumed by UI/API without pulling use cases. |
| Contract boundary | Define minimal `PlanSpec` in `packages/contracts/src/index.ts`, plus shared literal unions for constrained fields. | Full Zod schemas; domain entity model. | This slice establishes shape compatibility only. Full validation pipeline belongs to `07-v1-plan-wizard`; no concrete domain entities are introduced here. |
| Isolation proof | Add Vitest to `packages/domain` and first write a failing use-case isolation test, then the trivial use case. | Rely on type-check only. | The spec requires executable proof that a use case test runs without framework, UI, network, or DB modules. |

## Layer Dependency Diagram

No runtime sequence diagram is needed: this slice defines static architecture boundaries, not a request flow.

```text
apps/web ───────────────┐
apps/api ───────────────┼──→ packages/domain ──→ packages/contracts
future adapters/infra ──┘              │
                                       └── no imports from apps, infra, DB, UI, Fastify, Next

packages/contracts ──→ no workspace dependencies
```

Allowed direction is outer-to-inner only. `dependency-cruiser` forbids `packages/domain/**` from importing `apps/**`, `packages/infra/**`, framework packages (`next`, `react`, `fastify`), DB/auth/payment/AI modules, or Node network modules. A deliberate file such as `packages/domain/src/bad.ts` importing `fastify` or `../../apps/api/...` fails `pnpm architecture`; because root `build` runs that script, `pnpm build` also fails with a layer-boundary error.

## File Changes

| File | Action | Description |
|---|---|---|
| `package.json` | Modify | Add root `architecture` script, root `dependency-cruiser` devDependency, and run guards before recursive build. |
| `.dependency-cruiser.cjs` | Create | Declare Clean Architecture forbidden dependency rules. |
| `scripts/deps-guard.mjs` | Modify | Include `packages/domain/package.json` in prohibited dependency scanning only; do not mix layer rules into it. |
| `packages/contracts/src/index.ts` | Modify | Export `PlanSpec` and supporting literal union types. |
| `packages/domain/*` | Create | Workspace package, tsconfig, Vitest config, source, and isolation test. |
| `apps/web/package.json` | Modify | Add `@kinora/contracts` workspace dependency so wizard payload code can consume `PlanSpec`. |

## Interfaces / Contracts

```ts
export type PlanGoal = "strength" | "hypertrophy" | "fat_loss" | "general_fitness";
export type TrainingLocation = "home" | "gym" | "outdoor";

export interface PlanSpec {
  goal: PlanGoal;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  location: TrainingLocation;
  equipment: string[];
  limitations: string[];
  confirmed: boolean;
}
```

In scope: the shared shape, importability from web/API/domain, and minimal boundary checks in API adapters before using untrusted input. Deferred: Zod schemas, cross-field validation, medical limitation semantics, conversational extraction, persistence, and wizard UI.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `packages/domain` use case isolation | RED→GREEN Vitest test imports only `@kinora/domain` and `@kinora/contracts`, executes a trivial `createPlanDraft(spec)` use case, and asserts no framework/db module import is required. |
| Architecture | Domain cannot import outer layers | `pnpm architecture` runs `dependency-cruiser`; fixture/manual violation fails with named layer-boundary rule. |
| Integration | Existing app tests still pass | `pnpm --filter web test`, `pnpm --filter api test`, and `pnpm --filter @kinora/domain test`. |

## Migration / Rollout

No data migration required. Rollout is build-time only: add the domain package, wire architecture checks into root scripts, keep `pnpm deps-guard` unchanged as the capability guard, and verify `pnpm build`, `pnpm test`, and `pnpm deps-guard`.

## Open Questions

None.
