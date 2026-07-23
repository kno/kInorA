# Proposal: User Memory Vector

## Intent

Advance README roadmap item `10b-v1-user-memory-vector` as a real, privacy-first vertical slice: users can see and control remembered facts, confirm one eligible durable memory, and observe one AI flow using that memory to reduce repeated context entry.

Target users are authenticated athletes creating or regenerating plans after 10a structured memory exists. Business outcome: memory becomes trustworthy because it is visible, opt-in, reversible, and demonstrably useful in a bounded plan-generation interaction.

## Scope

### In Scope
- Memory-management UI/API: list, review, delete immediately, and disable vector memory.
- One user-confirmed creation flow for an eligible durable fact, excluding raw transcripts, secrets, full plans, and sensitive health data by default.
- One bounded AI retrieval flow that uses tenant+user-scoped memory in context and fail-opens to default behavior.

### Out of Scope
- Broad chat/voice UX, automatic unconfirmed extraction, provider expansion, sophisticated ranking, and full-plan/transcript embedding.
- Memory of sensitive health data unless a later privacy-approved requirement explicitly allows it.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `10b-v1-user-memory-vector`: expand from backend foundation to visible user-controlled memory creation, management, retrieval, deletion, disablement, isolation, and fallback.
- `12-v1.1-interactive-text-chat`: keep advanced chat breadth deferred; 10b only proves one bounded retrieval interaction.

## Approach

Use PostgreSQL + pgvector with configurable embeddings, `EmbeddingGenerator`, and `VectorMemoryRepository`. Store compact confirmed fact summaries with tenant/user, source, provider/model/dimension/version, timestamps, and deletion metadata. Add web/API controls for memory review. Inject top-K approved memories into one plan-related AI context path; if disabled or retrieval fails, continue without memory.

## First-Slice Acceptance Boundary

- User opts in, confirms one fact, sees it in memory UI, deletes/disables it, and it stops being retrieved.
- The AI interaction shows behavior/context affected by that memory without exposing raw stored content unnecessarily.
- Cross-tenant/user isolation and fail-open behavior are proven by tests.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/web/src/` | Modified | Memory-management screen and confirmation UX. |
| `apps/api/src/routes/`, `packages/contracts/src/index.ts` | Modified | Memory CRUD/settings/retrieval contracts. |
| `apps/api/src/db/schema.ts`, repositories | Modified/New | pgvector tables, deletion, tenant/user-filtered search. |
| `apps/api/src/ai/` | Modified | Embedding port and bounded retrieval injection. |
| `docker-compose.yml`, docs, CI env | Modified | pgvector and embedding configuration. |

## Risks and Tradeoffs

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Privacy over-collection | High | Opt-in, user confirmation, allowlist eligibility, excluded categories. |
| Cross-user leakage | Med | Mandatory predicates plus isolation tests. |
| UI scope creep | Med | Only management plus one confirmation/retrieval slice. |
| Model drift/cost | Med | Persist model metadata; configurable provider; top-K limits. |
| pgvector deployment gap | Med | Additive migration, documented extension setup. |

## Rollback Plan

Disable memory config, hide UI entry points, stop writes/retrieval, and apply reversible additive migration after deletion/export review. Explicit deletion remains immediate.

## Dependencies

- Completed `10a-v1-user-memory-structured`; PostgreSQL with pgvector; configured embedding provider/model.

## Success Criteria

- [ ] A user can opt in, confirm, view, delete, and disable vector memories.
- [ ] One AI flow demonstrably uses approved memory and fail-opens when unavailable.
- [ ] Raw transcripts, secrets, full plans, and sensitive health data are excluded by default.
- [ ] Tenant+user isolation and immediate deletion are verified.
