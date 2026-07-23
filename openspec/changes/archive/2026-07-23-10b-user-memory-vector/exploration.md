## Exploration: 10b-user-memory-vector

### Current State
kInorA already has structured, user-scoped memory from 10a: `user_profiles` and `user_preferences` are unique by `userId`, use authenticated-session scope only, and were verified with 9/9 requirements and 25/25 scenarios passing. Existing plan generation is async behind a hexagonal `PlanGenerator` port, with dynamic provider selection for OpenRouter/OpenAI/Anthropic/Google/OpenCode-Go, Langfuse tracing, prompt masking for limitations, and `MockPlanGenerator` for tests. PostgreSQL and Drizzle are already available, but no embedding API, vector schema, vector repository, chat message store, pgvector dependency/migration, or retrieval port exists yet.

The current main spec for `10b-v1-user-memory-vector` is intentionally small: store eligible conversation context as embeddings, continue safely with empty memory, and filter retrieval by tenant id and user id. The roadmap positions this before interactive text/voice chat, while spec `12-v1.1-interactive-text-chat` already expects future conversation turns to be stored in both structured message logs and vector memory.

### Affected Areas
- `openspec/specs/10b-v1-user-memory-vector/spec.md` — existing source-of-truth requirements are too thin for privacy, eligibility, deletion, retention, fallback, and provider behavior; proposal/spec round should expand them.
- `packages/contracts/src/index.ts` — likely needs DTOs/contracts for memory records, retrieval results, and possibly consent/settings if exposed across API/web boundaries.
- `apps/api/src/db/schema.ts` — needs additive tables for conversation memory/message storage and vector embeddings; must preserve tenant/user filters and cascade/delete behavior.
- `apps/api/src/db/repositories/` — needs repositories/ports for storing eligible memory chunks, vector search, deletion, and retention pruning.
- `apps/api/src/ai/port.ts` and `apps/api/src/ai/adapter-factory.ts` — current AI port only generates plans; embedding generation should be a separate hexagonal port, reusing available `@langchain/openai` only if the proposal chooses provider-coupled embeddings.
- `apps/api/src/ai/generation-service.ts` and future chat services — retrieval must be injected into AI context without logging raw sensitive memory or blocking plan/chat flows when unavailable.
- `apps/api/README.md`, `docker-compose.yml`, CI/deploy env docs — embedding provider keys/model and vector-store requirements are currently undocumented/missing.
- `openspec/specs/12-v1.1-interactive-text-chat/spec.md` — future chat already depends on structured + vector memory; 10b should define foundations without implementing the full chat UI.

### Approaches
1. **PostgreSQL pgvector + separate embedding port** — Add a `user_memory_embeddings` table in Postgres with `tenantId`, `userId`, source metadata, text summary, embedding vector, timestamps, and indexes; create `EmbeddingGenerator` and `VectorMemoryRepository` ports.
   - Pros: stays inside existing Postgres operational model, cleanly enforces tenant/user SQL filters, simple additive Drizzle migration, no new external database, easy cascade/deletion, testable with mocked embedding port.
   - Cons: requires pgvector extension support in local/prod Postgres and Drizzle migration; vector dimensions bind rows to a chosen embedding model; ANN tuning may be deferred.
   - Effort: Medium

2. **External managed vector store** — Store embeddings in a dedicated vector database/service while keeping metadata in Postgres.
   - Pros: better vector search operations at scale, built-in ANN/index tooling, can avoid managing pgvector tuning.
   - Cons: new vendor, secrets, network latency, harder transactional consistency/deletion proof, bigger security review, higher operational burden for first slice.
   - Effort: High

3. **Structured-memory-only bridge, vector later** — Reuse 10a profile/preferences and future chat logs, retrieve by recency/metadata first, defer actual embeddings.
   - Pros: cheapest and safest implementation, no new provider or vector extension.
   - Cons: does not satisfy roadmap/spec requirement to store embeddings; risks building a throwaway abstraction.
   - Effort: Low but insufficient

### Recommendation
Use **PostgreSQL pgvector + separate embedding port** for the proposal. The first slice should be a backend foundation only: schema/migration, contracts, embedding provider port with mock implementation, vector repository with strict `{ tenantId, userId }` filtering, eligible-memory write path, retrieval path returning top-K snippets, deletion/retention hooks, and graceful fallback when embedding/search fails. Do not implement full conversational chat UI in 10b; keep that for `12-v1.1-interactive-text-chat`.

Embed durable, user-authored memory facts only after an explicit persistence boundary: confirmed chat turns/facts, extracted stable preferences, user-confirmed corrections, and possibly completed plan feedback summaries. Do not embed raw health limitations, secrets, transient drafting text, provider responses, failed generations, or full workout programs by default. Prefer compact memory summaries with source metadata over raw full transcripts.

### Risks
- Privacy risk: conversational memory may contain health data. The proposal must define consent, eligibility, redaction, deletion, and Langfuse/log masking before implementation.
- Isolation risk: vector search must never run without tenant and user predicates; tests must prove cross-user and cross-tenant exclusion.
- Operational risk: pgvector may not be enabled in production Postgres image/database; deployment must include extension creation and rollback.
- Model drift risk: embedding dimensions depend on the selected embedding model; changing models requires migration/backfill strategy.
- Cost/latency risk: embedding every turn synchronously would slow chat/plan flows; first slice should batch or fire-and-forget where safe and fall back to empty retrieval.
- Scope risk: interactive text/voice chat specs are future v1.1; 10b should not expand into full chat product unless the proposal explicitly accepts that scope.

### Ready for Proposal
Yes — with open product decisions. The proposal should frame 10b as a privacy-first vector memory foundation, not a full chat UI. It should ask the user to decide: whether memory is opt-in or enabled by default, which facts are eligible for embedding, retention/deletion policy, whether pgvector is acceptable for first slice, and which embedding provider/model to use.
