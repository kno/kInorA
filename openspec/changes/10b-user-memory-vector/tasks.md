# Tasks: User Memory Vector

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650-850 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 schema/contracts → PR2 embedding/retrieval → PR3 API lifecycle → PR4 UI/i18n/verification |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Contracts + pgvector schema/migration foundation | PR 1 | `pnpm --filter @kinora/contracts test && pnpm --filter api test -- src/db/repositories/__tests__/vector-memory.test.ts` | `pnpm --filter api db:migrate` on pgvector Postgres | `packages/contracts/src/index.ts`, `apps/api/src/db/schema.ts`, `apps/api/drizzle/0010_vector_memory.sql` |
| 2 | Embedding/retrieval ports with validation, retry, timeout, fail-open | PR 2 | `pnpm --filter api test -- src/ai/__tests__/vector-memory-retriever.test.ts` | `pnpm --filter api test -- src/ai/__tests__/generation-service.memory.test.ts` | `apps/api/src/ai/embedding-port.ts`, `apps/api/src/ai/memory-retriever.ts`, `apps/api/src/ai/generation-service.ts` |
| 3 | API memory lifecycle: opt-in, confirm, list/review/delete/disable, isolation, telemetry | PR 3 | `pnpm --filter api test -- src/routes/__tests__/user-memories.test.ts` | `pnpm --filter api test -- src/routes/__tests__/user-memories.test.ts -t "delete invalidates retrieval"` | `apps/api/src/routes/user-memories.ts`, `apps/api/src/app.ts`, `apps/api/src/db/repositories/vector-memory.ts` |
| 4 | UI + i18n + integration/E2E + rollout/rollback proof | PR 4 | `pnpm --filter web test -- src/app/(app)/memory/__tests__/page.test.tsx` | `pnpm --filter web test` + memory-flow E2E on local API/UI | `apps/web/src/app/(app)/memory/`, `apps/web/src/i18n/messages/en.json`, `apps/web/src/i18n/messages/es.json`, `docker-compose.yml`, docs |

## Phase 1: Foundation / Infrastructure

- [x] 1.1 RED: add failing contract/repo tests for tenant+user isolation, idempotency, disabled state, and dimension mismatch in `packages/contracts/src/contracts.test.ts` and `apps/api/src/db/repositories/__tests__/vector-memory.test.ts`.
- [x] 1.2 GREEN: add `UserMemory`/`MemorySettings` DTOs in `packages/contracts/src/index.ts` and pgvector tables/indexes + extension setup in `apps/api/src/db/schema.ts` and `apps/api/drizzle/0010_vector_memory.sql`.
- [x] 1.3 TRIANGLE: implement `apps/api/src/db/repositories/vector-memory.ts` with scoped list/create/delete/disable/search and wire exports in the API composition root.

## Phase 2: Core Implementation

- [x] 2.1 RED: add failing tests for `apps/api/src/ai/__tests__/vector-memory-retriever.test.ts` covering provider/model/version/dimension compatibility, one retry, timeout, and fail-open retrieval.
- [x] 2.2 GREEN: add `apps/api/src/ai/embedding-port.ts` and `apps/api/src/ai/memory-retriever.ts`; persist provider/model/version/dimension metadata and normalize empty/offline errors to `[]`.
- [x] 2.3 TRIANGLE: inject approved memory context in `apps/api/src/ai/generation-service.ts`/`prompt.ts` only for the bounded plan slice; keep provider failures non-blocking.

## Phase 3: Integration / Wiring

- [x] 3.1 RED: add route/service tests in `apps/api/src/routes/__tests__/user-memories.test.ts` and `apps/api/src/ai/__tests__/generation-service.memory.test.ts` for opt-in, confirm, list/review/delete/disable, isolation, deletion invalidation, and telemetry.
- [x] 3.2 GREEN: implement `apps/api/src/routes/user-memories.ts` and wire `apps/api/src/app.ts` to the new repo, lifecycle endpoints, and audit hooks.
- [x] 3.3 TRIANGLE: verify cross-tenant/user guards, safe confirmation failure, and rollback-safe disable/delete paths in the API layer.

## Phase 4: Testing / Cleanup

- [ ] 4.1 RED: add web tests for `apps/web/src/app/(app)/memory/page.tsx` covering loading, empty, error, offline, and keyboard/a11y states.
- [ ] 4.2 GREEN: build the memory-management UI under `apps/web/src/app/(app)/memory/`, wire nav copy in `apps/web/src/app/(app)/layout.tsx`, and add `en.json`/`es.json` keys.
- [ ] 4.3 TRIANGLE: add integration/E2E coverage proving confirmed memory changes plan context, plus rollout/rollback notes in docs and `docker-compose.yml`.
