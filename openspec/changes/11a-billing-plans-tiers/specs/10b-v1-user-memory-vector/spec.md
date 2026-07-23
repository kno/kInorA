# Delta for 10b-v1-user-memory-vector

## MODIFIED Requirements

### Requirement: Vector Conversation Memory

The system MUST store only opt-in, user-confirmed, eligible durable facts as compact vector memory when active-tenant entitlement allows premium vector-memory writes and hybrid tenant/member quota consumption succeeds. Records MUST remain tenant-scoped, user-scoped, reviewable, auditable, and tagged with source, provider, model, dimension, and schema version. The system MUST NOT embed raw transcripts, secrets, full plans, sensitive health data by default, or denied-tenant memories.
(Previously: vector writes were gated by user opt-in and eligibility, not billing entitlement.)

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
(Previously: all empty, disabled, offline, misconfigured, unavailable, incompatible, or failed retrieval continued without memory.)

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
