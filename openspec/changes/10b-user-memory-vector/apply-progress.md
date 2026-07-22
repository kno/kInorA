# Apply Progress: 10b-user-memory-vector

## Status

- Change: `10b-user-memory-vector`
- Slice: `4 / UI + integration proof + rollout notes`
- Apply state: `complete`
- Mode: `Strict TDD`
- Delivery: `stacked-to-main` chained slice
- Size handling: `chained PR slice (no size:exception requested)`

## Completed Tasks

- [x] 1.1 RED: added failing contract/repo/schema tests for lifecycle, isolation, idempotency, disabled state, and dimension metadata.
- [x] 1.2 GREEN: added `UserMemory` / `MemorySettings` contracts plus pgvector schema and `0010_vector_memory.sql` migration foundation.
- [x] 1.3 TRIANGLE: implemented `VectorMemoryRepository` with scoped list/create/delete/disable/search foundations and compatibility filtering.
- [x] 2.1 RED: added failing tests for `apps/api/src/ai/__tests__/vector-memory-retriever.test.ts` covering provider/model/version/dimension compatibility, retry, timeout, fail-open retrieval, duplicate retry, and isolation handoff.
- [x] 2.2 GREEN: added `apps/api/src/ai/embedding-port.ts` and `apps/api/src/ai/memory-retriever.ts`; introduced configurable embedding metadata validation, OpenAI adapter boundary, bounded retry/timeout outcomes, fail-open retrieval, and idempotent write coordination over the Slice 1 repository.
- [x] 2.3 TRIANGLE: hardened compatibility filtering, disabled/deleted exclusion, tenant+user isolation, bounded timeout/provider exhaustion, idempotent retry persistence, and no-sensitive-content logging at the embedding/retrieval boundary.
- [x] 3.1 RED: added failing route/service and bounded generation tests in `apps/api/src/routes/__tests__/user-memories.test.ts` and `apps/api/src/ai/__tests__/generation-service.memory.test.ts` for opt-in, confirm, list/review/delete/disable, isolation, deletion invalidation, provider failure/timeout, and telemetry.
- [x] 3.2 GREEN: implemented `apps/api/src/user-memory/service.ts`, `apps/api/src/routes/user-memories.ts`, wired `apps/api/src/app.ts`, and extended contracts for list/create/delete/settings responses.
- [x] 3.3 TRIANGLE: verified cross-tenant/user guards, safe ineligible/failure handling, immediate delete/disable exclusion, idempotency, and fail-open bounded retrieval telemetry while keeping UI/chat/provider expansion deferred.
- [x] 4.1 RED: added failing web tests for the memory page/client/loading states, delete/disable confirmation, retry, app-shell navigation wiring, and accessibility-focused recovery flows.
- [x] 4.2 GREEN: built the web memory-management page/client/actions, wired translated memory navigation through the app layout + app shell, and added EN/ES catalog keys in the shared i18n package.
- [x] 4.3 TRIANGLE: added deterministic authenticated route-integration coverage proving explicit confirmed memory changes the generated plan context, added rollout/rollback notes for pgvector + embedding runtime alignment, and ran a bounded Podman-backed browser smoke.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `packages/contracts/src/contracts.test.ts` | Unit | ✅ `pnpm --filter @kinora/contracts exec vitest run src/contracts.test.ts` | ✅ Written first | ✅ Passed after contract additions | ✅ lifecycle + eligibility + config cases | ✅ Clean |
| 1.1 / 1.3 | `apps/api/src/db/repositories/__tests__/vector-memory.test.ts` | Unit | ✅ `pnpm --filter api exec vitest run src/db/repositories/__tests__/vector-memory.test.ts` baseline green before later edits | ✅ Written first | ✅ Passed after repository implementation | ✅ invalid eligibility, idempotency, disable, delete, isolation, compatibility cases | ✅ extracted scoped helpers |
| 1.2 | `apps/api/src/db/__tests__/vector-memory-schema.test.ts` | Unit | N/A (new) | ✅ Written first | ✅ Passed after schema + migration creation | ✅ enum/index/runtime cases | ➖ None needed |
| 2.1 / 2.2 / 2.3 | `apps/api/src/ai/__tests__/vector-memory-retriever.test.ts` | Unit | ✅ `pnpm --filter api exec vitest run src/ai/__tests__/vector-memory-retriever.test.ts` baseline green before Slice 3 | ✅ Written first | ✅ Passed after embedding/retrieval port implementation | ✅ empty, timeout, offline, provider failure, dimension mismatch, compatibility, privacy cases | ✅ boundary kept pure |
| 3.1 | `apps/api/src/routes/__tests__/user-memories.test.ts`, `apps/api/src/ai/__tests__/generation-service.memory.test.ts` | Integration + Unit | ✅ prior route/generation suites green before edits | ✅ Written first | ✅ Passed after lifecycle wiring | ✅ empty, sensitive, duplicate, isolation, disable, timeout, provider failure, delete invalidation, retrieval-reject fail-open cases | ✅ extracted lifecycle helpers |
| 4.1 / 4.2 | `apps/web/src/app/(app)/memory/__tests__/MemoryPageClient.test.tsx`, `apps/web/src/app/(app)/memory/__tests__/page.test.tsx`, `apps/web/src/app/(app)/memory/__tests__/loading.test.tsx`, `apps/web/src/components/AppShell/__tests__/AppShell.test.tsx`, `apps/web/src/app/(app)/__tests__/layout.test.tsx` | Component + Server component | ✅ app-shell/layout and catalog-parity baselines green before edits | ✅ Written first | ✅ Passed after UI/actions/layout wiring | ✅ happy path, empty, loading, error, offline, retry, delete/disable confirmation, focus recovery, nav propagation | ✅ extracted server-only memory client + thin actions |
| 4.3 | `apps/api/src/routes/__tests__/plan-generation.memory-flow.test.ts` | Integration | N/A (new) | ✅ Written first; initial run failed because the deterministic retriever boundary was not yet wired, so the generated plan stayed on the default title | ✅ `pnpm --filter api exec vitest run src/routes/__tests__/plan-generation.memory-flow.test.ts src/ai/__tests__/generation-service.memory.test.ts` → PASS, 2 files / 7 tests | ✅ explicit confirmed-memory happy path + disabled-settings fail-open path across authenticated routes | ✅ extracted in-memory vector store + plan state harness |
| 4.3 | `scripts/__tests__/vector-rollout-docs.test.ts` | Docs/config | N/A (new) | ✅ Written first; initial run failed because README, `apps/api/README.md`, and `docker-compose.yml` lacked embedding-alignment and rollback notes | ✅ `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts scripts/__tests__/vector-rollout-docs.test.ts` → PASS, 2 files / 4 tests | ✅ root docs + API docs + compose comments/config all covered | ➖ None needed |

## Test Summary

- Total tests written: 4 new Slice 4.3 tests across 2 files
- Total tests passing: `pnpm --filter api exec vitest run src/routes/__tests__/plan-generation.memory-flow.test.ts src/ai/__tests__/generation-service.memory.test.ts` → 2 files / 7 tests; `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts scripts/__tests__/vector-rollout-docs.test.ts` → 2 files / 4 tests; `pnpm --filter @kinora/i18n exec vitest run src/__tests__/catalog-parity.test.ts` → 1 file / 8 tests
- Layers used: Unit/Docs (2), Integration (2), E2E (0 new; bounded smoke run separately)
- Approval tests: None — new coverage/docs task rather than a behavior-preserving refactor
- Pure functions created: 0

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `pnpm --filter api exec vitest run src/routes/__tests__/plan-generation.memory-flow.test.ts src/ai/__tests__/generation-service.memory.test.ts` → PASS, 2 files / 7 tests. `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts scripts/__tests__/vector-rollout-docs.test.ts` → PASS, 2 files / 4 tests. |
| Runtime harness command/scenario and exact result | `E2E_API_PORT=4100 API_BASE_URL=http://localhost:4100 pnpm test:e2e tests/e2e/browser-smoke.spec.ts --workers=1` → PASS with Podman-backed pgvector Postgres + migrated API/web stack, 1 Playwright test passed. Boundary: this smoke proves bounded runtime boot only; the confirmed-memory influence proof remains in deterministic authenticated route integration because the runtime stack uses the real provider pipeline and Slice 4.3 explicitly avoided unbounded external-provider E2E. |
| Rollback boundary | Revert `apps/api/src/routes/__tests__/plan-generation.memory-flow.test.ts`, `scripts/__tests__/vector-rollout-docs.test.ts`, `README.md`, `apps/api/README.md`, and `docker-compose.yml` to remove Slice 4.3 proof/docs only, leaving Slice 1–4 product behavior intact. |

## Verification

| Command | Result |
|---|---|
| `pnpm --filter api exec vitest run src/routes/__tests__/plan-generation.memory-flow.test.ts src/ai/__tests__/generation-service.memory.test.ts` | PASS — 2 files / 7 tests |
| `pnpm exec vitest run scripts/__tests__/vector-runtime-config.test.ts scripts/__tests__/vector-rollout-docs.test.ts` | PASS — 2 files / 4 tests |
| `pnpm --filter @kinora/i18n exec vitest run src/__tests__/catalog-parity.test.ts` | PASS — 1 file / 8 tests |
| `pnpm type-check` | PASS — 6 workspace projects |
| `pnpm architecture` | PASS — 1,584 modules / 4,552 dependencies; negative guards passed |
| `pnpm deps-guard` | PASS — all workspace manifests clean |
| `pnpm test:e2e tests/e2e/browser-smoke.spec.ts --workers=1` | BLOCKED first attempt — API port `4000` already in use in the local environment |
| `E2E_API_PORT=4100 API_BASE_URL=http://localhost:4100 pnpm test:e2e tests/e2e/browser-smoke.spec.ts --workers=1` | PASS — Podman runtime, pgvector Postgres migrated, 1 Playwright browser-smoke test passed |

## Exact Failure / Root Cause

- Slice 4 previously proved bounded vector-memory influence only at the service layer. There was no authenticated route-level integration proving that an explicit confirmed memory created through the lifecycle API reaches plan generation and alters the generated context.
- Rollout/rollback notes also stopped at the pgvector migration prerequisite; operators did not yet have checked-in guidance tying `VECTOR_MEMORY_EMBEDDING_*` alignment to the persisted vector cohort or documenting the current fail-open rollback boundary.
- The first bounded runtime smoke attempt failed for an environment reason, not a product defect: local port `4000` was already occupied. Re-running the same bounded smoke on `E2E_API_PORT=4100` passed.

## Deployment Notes

- `docker-compose.yml` now exposes the vector embedding runtime knobs (`VECTOR_MEMORY_EMBEDDING_PROVIDER`, `MODEL`, `VERSION`, `DIMENSION`, `TIMEOUT_MS`, `MAX_ATTEMPTS`) with the checked-in defaults used by the current persisted cohort.
- The current operational rollback boundary is fail-open, not schema removal: unsetting `OPENAI_API_KEY` (or otherwise misconfiguring the vector embedding runtime) disables confirmed-memory writes/retrieval while leaving the rest of the API online.
- Do not replace `pgvector/pgvector:pg17` with a plain Postgres image while `0010_vector_memory.sql` remains part of the migration chain.

## Deviations

- No scope deviation in product behavior. The only deliberate boundary decision was keeping the end-to-end proof deterministic at the authenticated route integration layer instead of driving the live runtime through a real external embedding/generation provider, because Slice 4.3 explicitly required a bounded, safe proof with mocks/adapters when full provider E2E was not appropriate.

## Escalated Slice 4 Correction

- Added asthma and adjacent health-sensitive terms to the default ineligible eligibility patterns; confirmed non-sensitive preference behavior remains eligible.
- Sanitized untrusted `memoryContext` at the prompt/provider boundary, redacting health-sensitive and instruction-like memory content while preserving safe confirmed preferences.
- Threaded the generated query embedding through the retrieval port and repository; pgvector now orders compatible, tenant/user/status/settings-filtered rows by cosine distance before applying the limit.
- Preserved fail-open behavior for embedding and repository failures, existing limitation masking, and user-confirmed memory injection.

### Correction Evidence

| Evidence | Result |
|---|---|
| Focused API tests | PASS — 6 files / 65 tests covering asthma classification, provider-boundary redaction, embedding propagation, cosine-order query wiring, authenticated memory flow, and fail-open paths. |
| Type-check | PASS — 6 workspace projects. |
| Architecture | PASS — 1,584 modules / 4,552 dependencies; negative guards passed. |
| Dependency guard | PASS — all workspace manifests clean. |
| Rollback boundary | Revert the correction hunks in `apps/api/src/user-memory/service.ts`, `apps/api/src/ai/prompt.ts`, `apps/api/src/ai/memory-retriever.ts`, `apps/api/src/db/repositories/vector-memory.ts`, and their focused tests without changing Slice 4 UI or unrelated warnings. |
