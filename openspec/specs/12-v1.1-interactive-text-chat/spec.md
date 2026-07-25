# 12-v1.1-interactive-text-chat Specification

## Purpose

Provide conversational create-plan screens via text chat, allowing users to describe goals, constraints, and preferences in natural language to co-create workout plans.

This spec maps to the conversational assistant and extracted-data panel from Open Design. It is v1.1 scope and does not replace the v1 card-mode create-plan flow. Chat Asistente is a Pro-gated feature (default create-plan mode for Pro tenants; Free tenants see a teaser and stay on the Formulario wizard), streams its assistant reply over SSE, and shares the exact same `plan_drafts` draft as the 07 card wizard.

## Requirements

### Requirement: Conversational Plan Definition

The system MUST accept natural-language text input and, per user turn, extract a `Partial<PlanSpec>` limited to the six wizard INPUT fields (`goal`, `daysPerWeek`, `sessionDurationMinutes`, `location`, `equipment`, `limitations`) plus optional `name`. It MUST NOT set `preferenceScores` (derived server-side by `derivePreferenceScores`) or `confirmed`. Every extracted field MUST be validated before merge: `goal` against `PlanGoal`, `location` against `TrainingLocation`, and `sessionDurationMinutes` bounded 15–240 (`validateSessionDuration`). Invalid, out-of-range, or ambiguous input MUST yield a deterministic clarifying question and MUST NOT write a bad value into the draft. LLM extraction failure MUST fail closed — return a safe clarifying prompt with the draft untouched.

#### Scenario: Full description extracts input fields

- GIVEN a user types "build muscle 4 days a week with just dumbbells"
- WHEN the turn is processed
- THEN the draft merges `goal="hypertrophy"`, `daysPerWeek=4`, `equipment=["dumbbells"]`
- AND `preferenceScores` and `confirmed` are not set

#### Scenario: Ambiguous input asks a clarifying question

- GIVEN a user types "I want to get fit"
- WHEN the turn is processed
- THEN the assistant asks deterministic follow-ups (days per week, equipment) and no bad field is written

#### Scenario: Out-of-range duration rejected

- GIVEN a user asks for "10-minute sessions" (below the 15-minute floor)
- WHEN the extracted `sessionDurationMinutes` is validated
- THEN it fails `validateSessionDuration` and the assistant asks for a value in 15–240 instead of merging it

#### Scenario: Invalid enum value not merged

- GIVEN extraction returns a `goal` or `location` outside `PlanGoal`/`TrainingLocation`
- WHEN the field is validated before merge
- THEN it is rejected, the draft is unchanged, and the assistant asks a clarifying question

#### Scenario: Empty input handled safely

- GIVEN a user submits an empty or whitespace-only message
- WHEN the turn is processed
- THEN no extraction/LLM work runs and the assistant prompts for a description; the draft is unchanged

#### Scenario: Extraction error fails closed

- GIVEN the LLM extraction call errors or times out
- WHEN the turn aborts
- THEN a safe clarifying prompt is returned and the draft is not corrupted

### Requirement: PlanSpec Edit Before Generation

Before generating a plan, the system MUST present the extracted `Partial<PlanSpec>` for per-field review and edit in the "Datos extraídos" panel. Edits MUST persist to the same shared draft. Generation MUST flow ONLY through the existing promote → confirm → generate path (`POST /plan-specs` then `POST /plan-specs/:id/confirm`); the chat surface MUST NOT introduce any new generation entry point.

#### Scenario: Review and edit an extracted field

- GIVEN the extracted draft shows `daysPerWeek=4`
- WHEN the user edits it to 3 in the panel
- THEN the shared draft persists `daysPerWeek=3` and that value is used at promote/confirm

#### Scenario: Generation only via confirm gate

- GIVEN a reviewed draft ready to generate
- WHEN the user selects "Generar plan"
- THEN generation runs through the existing promote → confirm → generate path and no alternate entry point is used

### Requirement: Streaming Chat Endpoint (SSE)

`POST /plan-specs/chat` MUST return `text/event-stream`. It MUST stream the assistant's prose as incremental `token`/`message` deltas, then emit exactly one terminal `draft` event carrying `{ draftSpec, missingFields, assistantMessage }`, or an `error` event on failure. The merged draft MUST be committed only on the terminal `draft` event, so a mid-stream failure never corrupts the draft. The client MUST render prose incrementally and MUST be able to retry after a mid-stream error. On client disconnect/abort the server MUST stop the LLM stream and MUST NOT leave an orphaned draft write.

#### Scenario: Prose streams then terminal draft

- GIVEN a Pro user sends a valid message
- WHEN the endpoint responds
- THEN assistant prose arrives as incremental deltas (loading state) and a terminal `draft` event delivers `{ draftSpec, missingFields, assistantMessage }`

#### Scenario: Mid-stream error does not corrupt the draft

- GIVEN the LLM stream fails after some prose has been sent
- WHEN a terminal `error` event is emitted
- THEN the shared draft is left unchanged and the client shows a retry affordance

#### Scenario: Client disconnect stops work

- GIVEN the client aborts the request mid-stream
- WHEN the server observes the disconnect (`AbortSignal`)
- THEN it stops the LLM stream, releases resources, and writes no draft

#### Scenario: Offline client can reconnect

- GIVEN the network drops while streaming
- WHEN connectivity returns
- THEN the client can re-issue the turn and the prior draft state is intact

### Requirement: Shared Plan Draft Across Modes

Chat MUST read and write the SAME `plan_drafts` draft (`spec_json` as `Partial<PlanSpec>`, one active draft per tenant+user) used by the 07 card wizard. Asistente and Formulario MUST be two modes over that single draft, and switching modes MUST preserve the in-progress spec. No new conversation/draft table may be introduced.

#### Scenario: Mode toggle preserves the draft

- GIVEN a user has partially filled a draft in Asistente mode
- WHEN they switch to Formulario (or back)
- THEN the same draft is shown with no loss of the in-progress spec

#### Scenario: One shared source of truth

- GIVEN a field set via chat
- WHEN the Formulario wizard reads the current draft
- THEN it reflects the chat-set value from the same `plan_drafts.spec_json`

### Requirement: Pro-Only Chat Gate (Fail-Closed)

`POST /plan-specs/chat` MUST require effective tier Pro, resolved via `resolveEffectiveTier` / a Pro entitlement port read from `authContext` — NEVER from the request body. A Free or expired-trial tenant MUST be denied fail-closed with a `premium_required`-style upgrade denial BEFORE any LLM work runs. Any tier/tenant value supplied in the request body MUST be ignored. The client default-mode selection is cosmetic; a Free token MUST be rejected regardless of the client mode.

#### Scenario: Pro tenant allowed

- GIVEN an active member of a Pro tenant
- WHEN they call `POST /plan-specs/chat`
- THEN the gate passes and extraction/streaming proceeds

#### Scenario: Free tenant denied before LLM work

- GIVEN a member of a Free tenant
- WHEN they call `POST /plan-specs/chat`
- THEN the request is rejected fail-closed with an upgrade-required denial and no LLM call is made

#### Scenario: Body tier spoof ignored

- GIVEN a Free tenant sends a body claiming `tier="pro"`
- WHEN the endpoint resolves entitlement
- THEN tier is read only from `authContext`/`resolveEffectiveTier`, the body is ignored, and the request is denied

#### Scenario: Expired trial denied

- GIVEN a tenant whose trial has expired to Free
- WHEN they call the chat endpoint
- THEN the request is denied fail-closed before any LLM work

### Requirement: Tier-Based Default Mode and Free Teaser

The create-plan screen's DEFAULT mode MUST be Asistente when effective tier is Pro and Formulario when Free, derived server-side (reusing the wizard's server-side billing visibility). Free users MUST see an Asistente teaser and a "Mejora a Pro" upgrade CTA and MUST NOT be able to run chat turns. The default selection is cosmetic and MUST NOT be the only protection — the server gate is the enforcement.

#### Scenario: Pro defaults to Asistente

- GIVEN a Pro tenant opens create-plan
- WHEN the screen loads
- THEN Asistente is the default mode with the Formulario toggle still available

#### Scenario: Free defaults to Formulario with teaser

- GIVEN a Free tenant opens create-plan
- WHEN the screen loads
- THEN Formulario is the working flow and an Asistente teaser + "Mejora a Pro" CTA are shown

#### Scenario: Free cannot run chat turns

- GIVEN a Free user viewing the Asistente teaser
- WHEN they attempt a chat turn
- THEN no turn runs and they are directed to the upgrade CTA

### Requirement: Privacy and Data Protection

Health and limitation text MUST be masked (`mask()` / `sanitizeMemoryContext`) before reaching the LLM or observability (LangChain/Langfuse). Chat transcripts MUST NOT be embedded as raw vector memory by default. All chat state and access MUST be tenant-scoped from `authContext`.

#### Scenario: Health text masked before LLM

- GIVEN a turn contains limitation/health details
- WHEN it is sent to the LLM/observability
- THEN the sensitive text is masked first

#### Scenario: No raw transcript embedding

- GIVEN a chat session with ordinary or sensitive turns
- WHEN the session ends
- THEN no raw transcript is embedded into the vector store

#### Scenario: Tenant scoping enforced

- GIVEN a member authenticated in tenant T
- WHEN chat reads or writes draft state
- THEN only T's draft is accessed, derived from `authContext`

### Requirement: Chat Billing Boundary

Chat and extraction turns MUST consume NO billing quota. Only the existing confirm → generate step MUST consume exactly one `plan_generation` unit, unchanged from today. No per-turn chat meter may be introduced in this change.

#### Scenario: Chat turn consumes no quota

- GIVEN a Pro tenant runs several chat/extraction turns
- WHEN the turns complete
- THEN no billing unit is consumed for any turn

#### Scenario: Confirm consumes exactly one plan_generation

- GIVEN a reviewed draft
- WHEN the user confirms to generate
- THEN exactly one `plan_generation` unit is consumed at the existing confirm gate

### Requirement: Chat History in Memory

Conversation turns MUST NOT be embedded as raw vector memory by default. Future chat MAY request user-confirmed durable facts from `10b-v1-user-memory-vector`, but broad chat memory remains deferred until a later SDD change specifies consent, controls, retrieval behavior, and tests.

#### Scenario: Resume previous conversation

- GIVEN a user returns after a week
- WHEN they open chat
- THEN chat MAY use approved structured history or confirmed durable facts only within approved slice boundaries

#### Scenario: No raw transcript embedding

- GIVEN chat contains ordinary turns, secrets, full plans, or sensitive health details
- WHEN the session ends
- THEN those turns MUST NOT be embedded as vector memory by default

#### Scenario: 10b bounded retrieval is not broad chat

- GIVEN 10b injects approved memory into one bounded plan-related AI flow
- WHEN interactive chat is planned
- THEN that proof MUST NOT be treated as full chat memory integration

#### Scenario: Chat fallback remains safe

- GIVEN future chat requests vector memory and retrieval is empty, disabled, offline, or unavailable
- WHEN chat generates a response
- THEN it MUST continue safely without vector memory

## Notes

- **Denial status (design decision)**: the Free/expired-trial denial on `POST /plan-specs/chat` is `403 { error: "premium_required" }` (or the specific `lapsedReason`), consistent with the existing `BillingDenialReason` → 403 convention used elsewhere (confirm/regenerate); 402 was considered and rejected as it appears nowhere else in the codebase.
- **Slice split (design)**: Slice 2 was split into S2a (SSE transport + Pro gate + fail-closed lifecycle, PR #209) and S2b (structured extraction terminal event + masking, PR #210) because the combined scope exceeded the ~200-authored-line per-slice budget; the specified events and boundaries are unchanged by the split.
- **OD non-mapping fields**: OD panel fields "Estructura" and "Nivel" do not map to `PlanSpec`; "Nivel"/`experienceLevel` MAY be read from `UserProfile` for display/prefill only and MUST NOT be written by chat.
