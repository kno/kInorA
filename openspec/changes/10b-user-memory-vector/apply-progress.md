# Apply Progress: 10b-user-memory-vector

## Status

- Change: `10b-user-memory-vector`
- Slice: `2 / Embedding + retrieval foundation`
- Apply state: `partial`
- Mode: `Strict TDD`
- Delivery: `stacked-to-main` chained slice
- Size handling: `chained PR slice (no size:exception requested)`

## Completed Tasks

- [x] 1.1 RED: added failing contract/repo/schema tests for lifecycle, isolation, idempotency, disabled state, and dimension metadata.
- [x] 1.2 GREEN: added `UserMemory` / `MemorySettings` contracts plus pgvector schema and `0010_vector_memory.sql` migration foundation.
- [x] 1.3 TRIANGLE: implemented `VectorMemoryRepository` with scoped list/create/delete/disable/search foundations and compatibility filtering.
- [x] 2.1 RED: added failing tests for `apps/api/src/ai/__tests__/vector-memory-retriever.test.ts` covering provider/model/version/dimension compatibility, retry, timeout, fail-open retrieval, duplicate retry, and isolation handoff.
- [x] 2.2 GREEN: added `apps/api/src/ai/embedding-port.ts` and `apps/api/src/ai/memory-retriever.ts`; introduced configurable embedding metadata validation, OpenAI adapter boundary, bounded retry/timeout outcomes, fail-open retrieval, and idempotent write coordination over the Slice 1 repository.
- [x] 2.3 TRIANGLE: added edge/regression coverage for compatibility filtering, disabled/deleted exclusion, tenant+user isolation, bounded timeout/provider exhaustion, idempotent retry persistence, and no-sensitive-content logging while keeping generation-service wiring deferred by scope.

## Corrective Feedback Applied

- Preserved the approved embedding decision behind a dedicated `EmbeddingGenerator` port and adapter factory instead of calling OpenAI from application logic.
- Kept retrieval fail-open to `[]` for timeout/offline/provider failure and dimension/config incompatibility.
- Generalized repository write validation from the hard-coded default dimension to caller-supplied embedding metadata so the dedicated embedding port owns configuration compatibility.
- Added defensive post-query repository filtering so disabled, deleted, incompatible, or cross-scope rows are excluded even if an adapter returns unexpected data.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `packages/contracts/src/contracts.test.ts` | Unit | ✅ `pnpm --filter @kinora/contracts test -- src/contracts.test.ts` initially failed only on new vector-memory assertions | ✅ Written first | ✅ Passed after contract additions | ✅ lifecycle + eligibility + config cases | ✅ Clean |
| 1.1 | `apps/api/src/db/repositories/__tests__/vector-memory.test.ts` | Unit | N/A (new) | ✅ Written first | ✅ Passed after repository implementation | ✅ invalid eligibility, dimension mismatch, owner isolation, fingerprint/idempotency, disable, delete cases | ✅ Clean |
| 1.2 | `apps/api/src/db/__tests__/vector-memory-schema.test.ts` | Unit | N/A (new) | ✅ Written first | ✅ Passed after schema + migration creation | ✅ enum coverage, ownership columns, migration/index checks | ✅ Clean |
| 1.2 corrective | `scripts/__tests__/vector-runtime-config.test.ts` | Unit | ✅ `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` → 85/85 passed before editing the existing E2E runtime helper | ✅ Written first | ✅ `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts` → 2/2 passed after pgvector runtime + docs updates | ✅ runtime image pin + migration prerequisite docs cases | ➖ None needed |
| 1.3 | `apps/api/src/db/repositories/__tests__/vector-memory.test.ts` | Unit | ✅ covered by the same focused repository suite | ✅ Written first | ✅ Passed after repository implementation | ✅ duplicate fingerprint short-circuit + disabled retrieval + cross-user/tenant cases | ➖ None needed |
| 2.1 | `apps/api/src/ai/__tests__/vector-memory-retriever.test.ts` | Unit | N/A (new) | ✅ `pnpm --filter api exec vitest run src/ai/__tests__/vector-memory-retriever.test.ts` initially failed with `Cannot find module '../embedding-port.js'` | ✅ Passed after embedding port + retriever implementation | ✅ success, empty, dimension mismatch, timeout, offline, provider retry exhaustion, duplicate retry, compatibility metadata cases | ✅ Clean |
| 2.2 | `apps/api/src/db/repositories/__tests__/vector-memory.test.ts` | Unit | ✅ `pnpm --filter api exec vitest run src/db/repositories/__tests__/vector-memory.test.ts` → PASS, 14/14 before changing repository validation | ✅ Existing RED from 2.1 exposed the missing configurable-dimension boundary | ✅ Passed after repository dimension validation used caller metadata instead of the hard-coded default | ✅ metadata/length mismatch case kept green while adapter-owned dimensions became configurable | ➖ None needed |
| 2.3 | `apps/api/src/db/repositories/__tests__/vector-memory.test.ts`, `apps/api/src/ai/__tests__/vector-memory-retriever.test.ts` | Unit | ✅ `pnpm --filter api exec vitest run src/db/repositories/__tests__/vector-memory.test.ts` → PASS, 14/14 and `pnpm --filter api exec vitest run src/ai/__tests__/vector-memory-retriever.test.ts` → PASS, 12/12 before edits | ✅ Wrote the defensive filtering regression first; it failed because `searchActiveCompatible` returned disabled/deleted/incompatible rows unchanged from the adapter | ✅ Passed after repository scope/compatibility guards filtered unexpected rows | ✅ added timeout exhaustion + provider fail-open/no-log coverage without widening scope into generation-service | ✅ extracted `belongsToScope` / `isCompatibleActiveRecord` helpers |

## Test Summary

- Total tests written: 49 vector-memory/runtime assertions across 5 files
- Total tests passing: `pnpm --filter api exec vitest run src/ai/__tests__/vector-memory-retriever.test.ts` 14/14, `pnpm --filter api exec vitest run src/db/repositories/__tests__/vector-memory.test.ts` 15/15, `pnpm --filter api test` 765/765
- Layers used: Unit (49), Integration (0), E2E (0)
- Approval tests: None — no behavior-preserving refactor task
- Pure functions created: 2 (`belongsToScope`, `isCompatibleActiveRecord`)

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm --filter api exec vitest run src/db/repositories/__tests__/vector-memory.test.ts` → PASS, 1 file / 15 tests passed. `pnpm --filter api exec vitest run src/ai/__tests__/vector-memory-retriever.test.ts` → PASS, 1 file / 14 tests passed. |
| Runtime harness command/scenario and exact result | `N/A` — the approved Slice 2 continuation explicitly stopped before API routes, UI, chat, runtime plan-generation wiring, and generation-service prompt injection; this batch remained unit-level foundation hardening only. |
| Rollback boundary | Revert `apps/api/src/db/repositories/vector-memory.ts`, `apps/api/src/db/repositories/__tests__/vector-memory.test.ts`, and `apps/api/src/ai/__tests__/vector-memory-retriever.test.ts` to remove only the Slice 2 triangle hardening without touching Slice 1 schema/contracts/runtime docs or the existing embedding/retrieval port boundary. |

## Verification

| Command | Result |
|---|---|
| `pnpm --filter api exec vitest run src/db/repositories/__tests__/vector-memory.test.ts` | PASS — 1 file / 15 tests |
| `pnpm --filter api exec vitest run src/ai/__tests__/vector-memory-retriever.test.ts` | PASS — 1 file / 14 tests |
| `pnpm --filter api test` | PASS — 55 files / 765 tests |
| `pnpm type-check` | PASS — 6 workspace projects |
| `pnpm architecture` | PASS — 1,579 modules / 4,515 dependencies; negative guards passed |
| `pnpm deps-guard` | PASS — all workspace manifests clean |

## Exact Failure / Root Cause

- Before this triangle pass, `VectorMemoryRepository.searchActiveCompatible()` trusted the adapter result set entirely; a bad adapter/mock could leak disabled, deleted, incompatible, or cross-scope rows back to callers despite the intended SQL predicates.
- Timeout/provider-failure paths were already fail-open, but Slice 2 lacked explicit regression coverage proving retries exhaust safely and that these foundation services never log raw query or summary content while failing.

## Deployment Prerequisite (Fail-Closed)

- Production still needs `OPENAI_API_KEY` (or a future provider-specific adapter) for real embedding generation.
- Local dev, CI, and VPS environments MUST run `pgvector/pgvector:pg17` (or another Postgres 17 image with pgvector installed) before applying `apps/api/drizzle/0010_vector_memory.sql`.
- Do not remove `CREATE EXTENSION vector` from the migration. The correct fix is provisioning pgvector where migrations run.

## Deviations

- `tasks.md` still names Slice 2.3 as generation-service/prompt injection, but this apply batch followed the newer approved scope override: triangle-hardening the embedding/retrieval foundation only. `generation-service.ts`, `prompt.ts`, routes, UI, chat, and prompt injection remain intentionally deferred to later slices.
