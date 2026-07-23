# 10b-v1-user-memory-vector Specification

## Purpose

Store conversational memory as embeddings for retrieval during AI interactions while preserving tenant and user boundaries.

## Dependencies

- `10a-v1-user-memory-structured`
- `08-v1-ai-plan-generation`

## Requirements

### Requirement: Vector Conversation Memory

The system MUST store only opt-in, user-confirmed, eligible durable facts as compact vector memory when active-tenant entitlement allows premium vector-memory writes and hybrid tenant/member quota consumption succeeds. Records MUST remain tenant-scoped, user-scoped, reviewable, auditable, and tagged with source, provider, model, dimension, and schema version. The system MUST NOT embed raw transcripts, secrets, full plans, sensitive health data by default, or denied-tenant memories.

#### Scenario: Confirmed eligible fact stored

- GIVEN vector memory is enabled, entitlement allows premium memory, and the user confirms "prefers morning workouts"
- WHEN the memory is saved
- THEN it is embedded with tenant id, user id, source, provider, model, dimension, version, and timestamps

#### Scenario: Ineligible fact rejected

- GIVEN a candidate contains a secret, raw transcript, full plan, or sensitive health detail
- WHEN eligibility is evaluated
- THEN vector storage is rejected and non-sensitive audit metadata is recorded

#### Scenario: Duplicate save is idempotent

- GIVEN an equivalent active memory exists for the same tenant and user
- WHEN the confirmed fact is saved again or retried
- THEN the system MUST update or return the existing record without creating another active memory or consuming quota twice

#### Scenario: Provider failure or timeout

- GIVEN embedding generation fails, times out, or is unavailable
- WHEN saving a confirmed memory
- THEN the user sees safe failure feedback and the operation emits non-sensitive telemetry

#### Scenario: Dimension mismatch

- GIVEN the embedding dimension differs from configured model dimension
- WHEN the memory write is validated
- THEN the vector write is rejected and observable failure metadata is emitted

#### Scenario: Expired trial blocks premium memory write

- GIVEN a tenant trial is expired with no active override
- WHEN a user confirms saving a vector memory
- THEN the write is denied before embedding and no memory row is created

#### Scenario: Suspended membership blocks memory write

- GIVEN user U is suspended, revoked, or inactive in tenant T
- WHEN U confirms saving a vector memory in T
- THEN the write is denied before embedding and no quota is consumed

### Requirement: Empty Memory Behavior

The bounded AI retrieval flow MUST first require active-tenant entitlement and hybrid quota allowance for premium memory retrieval. If entitlement is denied, retrieval MUST NOT run and the AI flow MUST continue without premium memory only where the parent AI operation itself is allowed. If entitlement is allowed, technical empty/offline/misconfigured/unavailable retrieval MUST fail open without exposing technical errors.

#### Scenario: Empty memory fallback

- GIVEN entitlement allows memory and the user has no active vector memories
- WHEN the bounded AI flow retrieves context
- THEN it receives empty memory context and uses default behavior

#### Scenario: Retrieval unavailable fallback

- GIVEN entitlement allows memory and vector search is offline, disabled, timed out, or unavailable
- WHEN retrieval runs
- THEN the flow continues without memory and emits operational telemetry

#### Scenario: Compatible memory affects response

- GIVEN entitlement allows memory and an approved memory says the user prefers morning workouts
- WHEN the bounded plan-related AI flow runs
- THEN injected context demonstrably influences the response or displayed context

#### Scenario: Incompatible vector excluded

- GIVEN entitlement allows memory and stored vectors use incompatible provider, model, dimension, or version
- WHEN retrieval runs
- THEN incompatible records are excluded and the flow continues with compatible or empty context

#### Scenario: Denied entitlement skips retrieval

- GIVEN a Free tenant without trial or override
- WHEN a bounded AI flow evaluates premium memory retrieval
- THEN retrieval is skipped for product entitlement reasons and technical fail-open is not used as a bypass

#### Scenario: Memory management remains available

- GIVEN a tenant's trial is expired
- WHEN the user lists, deletes, reviews, or disables memories
- THEN management controls remain available and tenant/user isolation still applies

#### Scenario: Trainer quota access cannot read memories

- GIVEN trainer O manages member U's quota in tenant T
- WHEN O views usage totals
- THEN U's vector memories, prompts, health details, and generated private content are not returned

### Requirement: Vector Memory Isolation

Vector storage, search, update, deletion, disablement, and retention MUST be constrained by tenant id and user id. Explicit deletion MUST immediately remove the memory from user-visible lists and retrievable/searchable context.

#### Scenario: Cross-user embedding excluded

- GIVEN user A has vector memories in tenant T
- WHEN user B in tenant T retrieves or manages memory
- THEN user A's memories MUST NOT be returned, changed, or deleted

#### Scenario: Cross-tenant embedding excluded

- GIVEN the same user id exists in tenants A and B
- WHEN tenant A retrieves or manages memory
- THEN tenant B memories MUST NOT be searched, returned, changed, or deleted

#### Scenario: Deletion invalidates retrieval

- GIVEN a user deletes a memory
- WHEN deletion completes
- THEN the memory is absent from the list and MUST NOT be retrieved in future AI context

#### Scenario: Audit and observability

- GIVEN storage, retrieval, rejection, deletion, disablement, or failure occurs
- WHEN the operation completes
- THEN telemetry records outcome, scope, operation, and reason without raw memory content

### Requirement: Memory Management UI

The system MUST provide authenticated memory-management UI/API controls to list, review, delete, and disable vector memories with privacy-safe copy and accessible loading, empty, error, and offline states.

#### Scenario: List and review memories

- GIVEN the user has active memories
- WHEN they open memory management
- THEN they can review each memory summary, metadata, and available controls

#### Scenario: Loading empty error offline states

- GIVEN memories are loading, absent, failed, or offline
- WHEN the screen renders
- THEN it shows accessible privacy-safe state copy without exposing raw sensitive content

#### Scenario: Disable memory

- GIVEN vector memory is enabled
- WHEN the user disables it
- THEN new writes stop and retrieval returns empty context until re-enabled

### Requirement: User Confirmation Flow

The system MUST include one explicit user-confirmation flow that creates an eligible durable memory and visibly confirms success or failure.

#### Scenario: Confirmation success

- GIVEN an eligible durable fact is proposed to the user
- WHEN the user confirms saving it
- THEN the memory is created and success is visible in the UI

#### Scenario: Confirmation rejected or failed

- GIVEN the user rejects saving or the save fails
- WHEN the flow completes
- THEN no active memory is created and the UI explains the result safely

### Requirement: First-Slice Boundary

The 10b slice MUST deliver memory management, one confirmation flow, and one bounded AI retrieval flow only. Broad chat/voice UX, automatic unconfirmed extraction, provider expansion, sophisticated ranking, and bulk migration MUST remain deferred.

#### Scenario: Deferred scope blocked

- GIVEN implementation proposes broad chat, voice, automatic extraction, or provider expansion
- WHEN evaluated against 10b
- THEN it is treated as out of scope unless a later SDD change approves it
