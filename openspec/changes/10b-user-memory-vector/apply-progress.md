# Apply Progress: 10b-user-memory-vector

## Status

- Change: `10b-user-memory-vector`
- Slice: `1 / Contracts + pgvector schema/migration foundation`
- Apply state: `partial`
- Mode: `Strict TDD`
- Delivery: `stacked-to-main` chained slice
- Size handling: `chained PR slice (no size:exception requested)`

## Completed Tasks

- [x] 1.1 RED: added failing contract/repo/schema tests for lifecycle, isolation, idempotency, disabled state, and dimension metadata.
- [x] 1.2 GREEN: added `UserMemory` / `MemorySettings` contracts plus pgvector schema and `0010_vector_memory.sql` migration foundation.
- [x] 1.3 TRIANGLE: implemented `VectorMemoryRepository` with scoped list/create/delete/disable/search foundations and compatibility filtering.

## Corrective Feedback Applied

- Exported the E2E Postgres image constant and switched checked-in runtime config from `postgres:17-alpine` to `pgvector/pgvector:pg17` in `docker-compose.yml` and `scripts/e2e-with-stack.mjs`.
- Added a focused config/doc regression test proving Slice 1 now pins a pgvector-capable Postgres runtime and documents the `CREATE EXTENSION vector` prerequisite.
- Updated `README.md`, `apps/api/README.md`, `.env.example`, and the CI smoke comment so the deployment assumption is explicit: do not weaken the migration; provide pgvector instead.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `packages/contracts/src/contracts.test.ts` | Unit | ✅ `pnpm --filter @kinora/contracts test -- src/contracts.test.ts` initially failed only on new vector-memory assertions | ✅ Written first | ✅ Passed after contract additions | ✅ lifecycle + eligibility + config cases | ✅ Clean |
| 1.1 | `apps/api/src/db/repositories/__tests__/vector-memory.test.ts` | Unit | N/A (new) | ✅ Written first | ✅ Passed after repository implementation | ✅ invalid eligibility, dimension mismatch, owner isolation, fingerprint/idempotency, disable, delete cases | ✅ Clean |
| 1.2 | `apps/api/src/db/__tests__/vector-memory-schema.test.ts` | Unit | N/A (new) | ✅ Written first | ✅ Passed after schema + migration creation | ✅ enum coverage, ownership columns, migration/index checks | ✅ Clean |
| 1.2 corrective | `scripts/__tests__/vector-runtime-config.test.ts` | Unit | ✅ `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` → 85/85 passed before editing the existing E2E runtime helper | ✅ Written first | ✅ `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts` → 2/2 passed after pgvector runtime + docs updates | ✅ runtime image pin + migration prerequisite docs cases | ➖ None needed |
| 1.3 | `apps/api/src/db/repositories/__tests__/vector-memory.test.ts` | Unit | ✅ covered by the same focused repository suite | ✅ Written first | ✅ Passed after repository implementation | ✅ duplicate fingerprint short-circuit + disabled retrieval + cross-user/tenant cases | ➖ None needed |

## Test Summary

- Total tests written: 34 new vector-memory/runtime assertions across 4 files
- Total tests passing: `scripts/__tests__/vector-runtime-config.test.ts` 2/2, `scripts/__tests__/e2e-resource-safety.test.ts` 85/85, `pnpm --filter api test` 747/747
- Layers used: Unit (34), Integration (0), E2E (0)
- Approval tests: None — no behavior-preserving refactor task
- Pure functions created: 0 in this corrective batch

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts` → PASS, 1 file / 2 tests passed. `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` → PASS, 1 file / 85 tests passed. |
| Runtime harness command/scenario and exact result | `CI=1 NO_COLOR=1 pnpm --filter api db:migrate` → FAIL, exit 1. Follow-up DB diagnostic against `postgres://kinora:kinora@localhost:5432/kinora` returned `AggregateError [ECONNREFUSED]` for both `::1:5432` and `127.0.0.1:5432`. `docker --version` → `command not found`; `podman info` → socket connection refused, so no bounded local container runtime was available to boot the newly pinned `pgvector/pgvector:pg17` image and re-run the migration. |
| Rollback boundary | Revert `docker-compose.yml`, `.github/workflows/ci-cd.yml`, `scripts/e2e-with-stack.mjs`, `scripts/__tests__/e2e-resource-safety.test.ts`, `scripts/__tests__/vector-runtime-config.test.ts`, `README.md`, `apps/api/README.md`, and `.env.example` to remove only the runtime-assumption correction without touching the Slice 1 contracts/schema/repository foundation. |

## Verification

| Command | Result |
|---|---|
| `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts` | PASS — 1 file / 2 tests |
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` | PASS — 1 file / 85 tests |
| `pnpm --filter api test` | PASS — 54 files / 747 tests |
| `pnpm type-check` | PASS — 6 workspace projects |
| `pnpm architecture` | PASS — 1,576 modules / 4,508 dependencies; negative guards passed |
| `pnpm deps-guard` | PASS — all workspace manifests clean |
| `CI=1 NO_COLOR=1 pnpm --filter api db:migrate` | FAIL — exit 1 |
| `docker --version` | FAIL — `command not found` |
| `podman info` | FAIL — socket connection refused |

## Exact Failure / Root Cause

- The Slice 1 migration still cannot be verified locally because there is no reachable Postgres at `localhost:5432`; the direct DB diagnostic returned `ECONNREFUSED` for both IPv6 and IPv4 loopback addresses.
- Before this corrective batch, the repository also encoded the wrong runtime assumption: checked-in Postgres references used `postgres:17-alpine`, which does not satisfy the migration's `CREATE EXTENSION vector` requirement.
- This batch fixed the repository assumption by pinning a pgvector-capable Postgres image, but runtime verification remains fail-closed until a real container runtime is available.

## Deployment Prerequisite (Fail-Closed)

- Local dev, CI, and VPS environments MUST run `pgvector/pgvector:pg17` (or another Postgres 17 image with pgvector installed) before applying `apps/api/drizzle/0010_vector_memory.sql`.
- Do not remove `CREATE EXTENSION vector` from the migration. The correct fix is provisioning pgvector where migrations run.

## Deviations

- None from the approved Slice 1 design. The corrective work only made the pgvector deployment/runtime assumption explicit and testable.
