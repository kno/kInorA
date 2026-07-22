# Design: User Memory Vector

## Technical Approach

Deliver the approved vertical slice by adding visible, opt-in vector memory as a Clean Architecture feature: contracts define DTOs, Fastify routes validate/authenticate, route-local ports hide persistence/AI adapters, Drizzle stores pgvector-backed records, and web screens use existing app-shell/i18n/offline patterns. Plan generation/adaptation is the only AI consumer: it retrieves compatible tenant+user memories, injects a compact privacy-safe context block, and fail-opens to current behavior.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Store | PostgreSQL `pgvector` tables | External vector DB | Keeps tenant/user predicates, cascade deletion, migrations, and rollback inside the existing Postgres/Drizzle model. |
| Creation | Explicit user confirmation only | Automatic chat extraction | Matches privacy specs; avoids raw transcripts, secrets, full plans, and sensitive health data by default. |
| AI integration | Retrieve in `PlanGenerationService` before `PlanGenerator.generate` | Provider-specific prompt mutation | Preserves the existing `PlanGenerator` port and lets retrieval fail open before adapter calls/Langfuse traces. |
| Provider config | `EmbeddingGenerator` port + env/config metadata | Hard-coded OpenAI model | Model/version/dimension must be configurable and persisted to exclude incompatible rows. |
| Delivery | Chained work units under 400 changed lines | One large PR | Schema, API, AI, and UI slices are separately reviewable and testable. |

## Data Flow

```text
Confirm fact:
Web confirm UI -> POST /user-memories -> eligibility -> embed -> VectorMemoryRepository -> pgvector
                         |                 | reject/audit-safe        | idempotent by tenant+user+fingerprint

Plan generation:
POST /plans/:id/generate -> PlanGenerationService -> MemoryRetriever -> pgvector topK
                                      | fail-open empty          |
                                      v                          v
                              PlanGenerator.generate(spec + memoryContext)

Delete/disable:
Web settings -> DELETE/PATCH /user-memories... -> tenant+user repo -> hard delete/disabled -> cache bust
```

Lifecycle states: `candidate` (UI-only proposal) -> `confirmed` -> `embedding_pending` -> `active`; terminal: `rejected`, `failed`, `deleted`. Disabled setting prevents new writes and retrieval but does not hide existing records from review/delete.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/contracts/src/index.ts` | Modify | Add memory DTOs, settings, create/delete responses, safe error codes. |
| `apps/api/src/db/schema.ts`, `apps/api/drizzle/0009_*.sql` | Modify/Create | Add `vector_memory_settings`, `user_memory_vectors`, `CREATE EXTENSION vector`, tenant/user/provider/model/dimension/version indexes. |
| `apps/api/src/db/repositories/vector-memory.ts` | Create | Tenant+user-scoped list/create/idempotent delete/disable/search methods. |
| `apps/api/src/ai/embedding-port.ts`, `memory-retriever.ts` | Create | Embedding, compatibility, timeout/retry, top-K retrieval abstractions. |
| `apps/api/src/ai/generation-service.ts`, `prompt.ts` | Modify | Add safe memory context injection before plan generation; never log raw memory. |
| `apps/api/src/routes/user-memories.ts`, `app.ts` | Create/Modify | Authenticated list/create/delete/settings routes wired in composition root. |
| `apps/web/src/app/(app)/memory/*`, `components/AppShell/*`, `i18n/messages/*.json` | Create/Modify | Memory management UI with loading/empty/error/offline states and nav copy. |
| `docker-compose.yml`, env/docs | Modify | Use pgvector-capable Postgres and document embedding provider/model/dimension. |

## Interfaces / Contracts

Contracts: `UserMemory { id, summary, source, status, createdAt, updatedAt, provider, model, dimension, version }`, `MemorySettings { enabled }`, `CreateUserMemoryRequest { factText, source, idempotencyKey }`, `DeleteUserMemoryResponse { deleted: true }`. Route ports MUST accept `{ tenantId, userId }` from `request.authContext`, never from client input.

Embedding policy: one retry for transient provider errors, hard timeout (configured, default 3s save / 1s retrieval), dimension validation before write, SHA-256 fingerprint over normalized summary+scope for idempotency. Retrieval filters `status='active'`, settings enabled, provider/model/dimension/version compatible, `tenantId`, `userId`, `deletedAt IS NULL`; failures emit telemetry and return `[]`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | eligibility, lifecycle, idempotency, dimension mismatch, prompt masking | Vitest with mocked ports. |
| Integration | routes/repositories isolation, deletion, disable, fail-open | Fastify + Drizzle-style repository tests; RED tests first. |
| Web | list/review/delete/disable, confirm success/failure, a11y states, catalog parity | React/Vitest, existing i18n parity tests. |
| AI | compatible memory affects plan context; retrieval failure unchanged | `MockPlanGenerator` assertions; no provider network. |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A: no executable-file classification | None | None |
| Git repository selection | N/A: no VCS automation | None | None |
| Commit state | N/A: no commit automation | None | None |
| Push state | N/A: no push automation | None | None |
| PR commands | N/A: no PR automation | None | None |

## Migration / Rollout

Roll out behind `VECTOR_MEMORY_ENABLED=false` default. Migration is additive: enable pgvector, create tables/indexes, deploy disabled, then enable per environment. Rollback disables writes/retrieval/UI entry; destructive table removal only after deletion/export review. Account deletion relies on FK cascade plus repository tests; explicit memory deletion is hard delete and invalidates any in-process retrieval cache by scoping cache keys to tenant+user+settings version or using no cross-request cache in v1.

## Open Questions

- [ ] Confirm initial embedding provider/model/dimension values for non-test environments.
