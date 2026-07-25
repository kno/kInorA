# Proposal: 12 — Interactive Text Chat (v1.1 conversational create-plan)

## Intent

Let users create a workout plan by describing their goals and constraints in natural
language, instead of only stepping through the v1 card wizard (07). The chat extracts a
structured `PlanSpec` from free text, streams its natural-language reply token-by-token,
shows the extracted data for review/edit, and then feeds the **existing** confirm → generate
path (08). This is the first conversational surface for kInorA and the authoritative
"Asistente" screen already exists in Open Design.

Chat is a **companion to — not a replacement for** — the card wizard: an Asistente/Formulario
mode toggle over a single shared `plan_drafts` draft. Voice (STT/TTS) is explicitly item 13,
not this change.

## Target Users

- New and returning users who prefer describing intent in prose ("build muscle 4 days a week
  with just dumbbells") over filling multi-step form cards.
- Existing wizard users who want to switch mid-draft between Asistente and Formulario without
  losing their in-progress spec.
- **Pro tenants** — chat Asistente is a **Pro feature** and the **primary (default) create-plan
  mode** for Pro users.
- **Free tenants** — keep the Formulario (07 card wizard) as their working flow and see an
  Asistente teaser / "Mejora a Pro" upgrade CTA; they cannot run chat turns.
- Chat/extraction turns consume no billing quota; only the final plan generation consumes
  `plan_generation` at confirm, exactly as today.

## Scope

### In Scope

- **Chat Asistente is a Pro feature, default for Pro.** The create-plan screen's DEFAULT mode is
  Asistente when effective tier = Pro, and Formulario (07 wizard) when Free. The
  Asistente/Formulario toggle still exists in both cases; effective tier only decides the
  initial/default mode. Source of truth is `resolveEffectiveTier`
  (`apps/api/src/billing/entitlement.ts`), derived **server-side** (reuse the 11b billing-visibility
  seam + the wizard's server-side data loading) — never trusted from the client.
- **Pro-only server gate on the endpoint (fail-closed).** The streaming `POST /plan-specs/chat`
  route MUST require effective tier Pro. A Free tenant is rejected fail-closed with an
  upgrade-required denial (mirror the existing premium-gate convention — a `premium_required`-style
  reason like `MemoryRetrievalEntitlementPort` / CheckEntitlement; exact 402-vs-403 status pinned
  in design). The server gate is the real enforcement; the client default-mode selection is
  cosmetic and is never the only protection.
- **Free UX teaser.** Free users see the Formulario as their working flow plus an Asistente teaser
  and a "Mejora a Pro" upgrade CTA toward the chat (reuse the existing upgrade CTA / `#pro-card` +
  billing i18n conventions from 11b). Free must not be able to actually run chat turns.
- **Mode toggle Asistente/Formulario over ONE shared draft.** Chat and the 07 wizard read and
  write the same `plan_drafts.spec_json` (`Partial<PlanSpec>`), one active draft per
  tenant+user. No new conversation/draft table.
- **Per-turn structured extraction (Approach A).** An LLM structured-output call maps each user
  message into a new Zod `PlanSpecDraftSchema` (`Partial<PlanSpec>`, enum-validated,
  `sessionDurationMinutes` bounded 15–240), which is merged into the existing draft. Missing
  fields drive **deterministic clarifying questions**.
- **Extraction target = the 6 wizard INPUT fields + optional `name` only**: `goal`,
  `daysPerWeek`, `sessionDurationMinutes`, `location`, `equipment`, `limitations`. The chat MUST
  NOT extract `preferenceScores` (derived server-side by `derivePreferenceScores`) or
  `confirmed`.
- **New streaming API route `POST /plan-specs/chat`** returning `text/event-stream` (SSE) from
  Fastify (authenticated, tenant-scoped from `authContext`, **Pro-gated and fail-closed** on both
  entitlement and LLM error). The
  assistant's natural-language reply **streams token-by-token**; the structured extraction result
  (`draftSpec` + `missingFields`) arrives as a **terminal structured event** at end-of-stream.
  Events: incremental `token`/`message` deltas, a terminal `draft` event carrying
  `{ draftSpec, missingFields, assistantMessage }`, and an `error` event.
- **New extraction port + adapter + pure prompt** in `apps/api/src/ai/`, reusing the existing
  provider/adapter-factory. Prose streams via LangChain `.stream()`; the structured extraction
  keeps the proven `withStructuredOutput({ method: "jsonSchema" })` pattern as the terminal,
  non-streamed step (structured-output does not stream partial JSON reliably — stream the prose,
  emit the structure at the end, or run a second non-streamed extraction pass). A Mock extractor
  provides deterministic, non-streamed tests.
- **Web Asistente UI** reproducing the OD "Asistente" layout: left chat pane, right "Datos
  extraídos" panel (per-field review/edit), "Generar plan" primary button, and the
  `btn-asistente`/`btn-formulario` mode toggle — wired to the existing draft, promote, and
  confirm actions. The client **consumes the SSE stream** (fetch `ReadableStream` / `EventSource`),
  renders incremental assistant text as it arrives, then updates the "Datos extraídos" panel from
  the terminal `draft` event, with graceful mid-stream error + reconnect/retry handling.
- **New i18n namespace** for chat copy in BOTH `en` and `es` catalogs (catalog parity enforced).
- **Privacy handling**: apply `mask()` / `sanitizeMemoryContext` to health/limitation text
  before it reaches LangChain/Langfuse; multi-turn state lives only in `plan_drafts.spec_json`.

### Out of Scope (non-goals)

- **Voice / STT / TTS** — that is item 13 (`mobile-voice.html` "Asistente de voz").
- **Raw-transcript vector embedding** — transcripts MUST NOT be embedded as vector memory by
  default (honors the canonical spec constraint). Broad chat memory stays deferred to a later
  change with its own consent/controls/tests.
- **A separate chat/extraction billing meter** — extraction turns consume **no** billing unit.
  Only the existing `plan_generation` gate at confirm consumes quota (Pro 500). The **Pro gate on
  the endpoint replaces the need for a per-turn meter in v1**; if per-turn cost later becomes a
  concern, a Pro-side meter is a future follow-up.
- **New conversation persistence table** — reuse `plan_drafts`.
- **Tool-calling agent (Approach B)** and any multi-turn agent framework.
- **OD panel fields that do not map to `PlanSpec`** — "Estructura" (no plan split on `PlanSpec`)
  and "Nivel" (`experienceLevel` lives on `UserProfile`, not `PlanSpec`) are scoped out of
  extraction; "Nivel" MAY be read from the user profile for display/prefill only, never written
  by chat into the spec.
- **Any change to the promote → confirm → generate path.** Generation flows only through the
  existing `POST /plan-specs/:id/confirm` gate. No new generation entry point.

## Approach

- **Reuse, don't duplicate.** The wizard already owns durable drafts
  (`POST /plan-specs/drafts`, `GET /plan-specs/drafts/current`), promotion
  (`POST /plan-specs` → `assertPlanSpecInput` → `derivePreferenceScores` → `assertPlanSpecShape`),
  and generation (`POST /plan-specs/:id/confirm` → consume `plan_generation` → `startGeneration`).
  Chat adds exactly one new surface: an **extraction step** that turns free text into a merged
  `Partial<PlanSpec>` draft. Everything downstream is unchanged.
- **Hexagonal confinement.** The extraction LLM call lives behind a NEW port in
  `apps/api/src/ai/`; the extraction use case (merge + validate) is a pure function testable with
  a Mock extractor. Web only sends text and renders results — it never imports LLM libs
  (`scripts/deps-guard.mjs` bans `openai|langchain|langfuse|ai-sdk` outside `apps/api`).
- **Server-enforced Pro gate, reusing the billing entitlement seam.** The endpoint resolves
  tenant/tier from `authContext` + `resolveEffectiveTier` (never the request body) and checks a
  Pro entitlement through an entitlement port living in `apps/api` (mirroring
  `MemoryRetrievalEntitlementPort` / CheckEntitlement). Free is rejected fail-closed with a
  `premium_required`-style denial before any LLM work. Web derives the default mode from the same
  server-side billing visibility the wizard already loads; the client selection is cosmetic.
- **Validate before merge.** Every extracted field is validated against its enum
  (`PlanGoal`, `TrainingLocation`) and `validateSessionDuration` (15–240) before merging into the
  draft. Invalid/ambiguous → clarifying question, never a silently-bad draft.
- **Fail-closed extraction, fail-open profile seed.** LLM extraction errors fail closed (return a
  safe clarifying prompt, no draft corruption). Opening extraction MAY seed from `UserProfile` /
  `UserPreferences` like the wizard's `applyInitialPrefill`.
- **Streaming (SSE), net-new for this repo.** `POST /plan-specs/chat` returns `text/event-stream`
  via Fastify `reply.raw`/hijack (or an SSE helper). The assistant prose streams token-by-token
  from LangChain `.stream()`; the merged draft is committed and emitted only on the **terminal
  `draft` event**, so a mid-stream failure never corrupts the draft. Chat streaming is separate
  from plan generation, which still runs via the existing async confirm → generate path (fire-and-
  forget `runGenerationTask` + WsRegistry notify), not the chat stream.
- **UI is the OD "Asistente" screen** (`docs/open-design/kinora/screens/web-create-plan.html`
  MODE A). Do not invent a new layout; map OD panel fields to the real `PlanSpec` and scope out
  the non-mapping ones as listed above.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modified | `PlanSpecDraftSchema` + chat request/response DTOs |
| `packages/domain/src/plan/` | New | pure merge/validation of extracted `Partial<PlanSpec>` |
| `apps/api/src/ai/` | New | extraction port + adapter + pure prompt + Mock extractor |
| `apps/api/src/billing/entitlement.ts` | Reused | `resolveEffectiveTier` + Pro entitlement port for the chat gate |
| `apps/api/src/routes/plan.ts` | Modified | streaming SSE `POST /plan-specs/chat` route (auth, tenant-scoped, Pro-gated, fail-closed) |
| `apps/web` create-plan | Modified | tier-based default mode + Asistente chat pane (SSE consumer) + "Datos extraídos" panel + mode toggle + Free upgrade teaser |
| `packages/i18n/src/messages/{en,es}.json` | Modified | new chat namespace (EN/ES parity) |

## Slicing (chained PRs, ~one session each, ≤~200 authored lines, TDD-able)

1. **Slice 1 — contracts + domain + extraction port (no route, no web, no streaming).**
   `PlanSpecDraftSchema` (`Partial<PlanSpec>`, enum-validated, duration 15–240) in contracts; the
   new extraction port + pure prompt in `apps/api/src/ai/` with a Mock extractor; the pure
   merge/validation use case in domain (extracted partial → validated → merged draft, missing-field
   detection). Fully unit-tested against the Mock. **Boundary: no HTTP route, no web, no streaming,
   no billing change.**
2. **Slice 2 — API streaming SSE `POST /plan-specs/chat`.**
   `text/event-stream` route via Fastify `reply.raw`/hijack: prose streams token-by-token from
   LangChain `.stream()` (`token`/`message` deltas), then a terminal `draft` event carrying
   `{ draftSpec, missingFields, assistantMessage }`, plus an `error` event. Authenticated,
   tenant-scoped from `authContext`, **Pro entitlement gate (fail-closed)** resolved via
   `resolveEffectiveTier` + an `apps/api` entitlement port — with tests for **Free-denied /
   Pro-allowed** — applies `mask()`/`sanitizeMemoryContext` to health/limitation text; the merged
   draft is committed to the shared `plan_drafts` **only on the terminal event**. **Boundary: no
   generation consume here — generation stays on the existing confirm gate.** If SSE transport +
   streamed prose + terminal structured extraction + the gate meaningfully exceeds ~200 authored
   lines, split into **S2a stream transport + Pro gate + fail-closed lifecycle** and **S2b
   structured extraction terminal event + masking**.
3. **Slice 3 — web Asistente UI (SSE consumer) + tier-based default + Free teaser + i18n.**
   Server-derived default mode (Asistente for Pro, Formulario for Free) reusing the wizard's
   server-side billing visibility; chat pane consuming the SSE stream (fetch
   `ReadableStream`/`EventSource`) with incremental assistant-text render + mid-stream
   error/reconnect handling; "Datos extraídos" review/edit panel populated from the terminal `draft`
   event; `Asistente/Formulario` mode toggle over the existing shared draft, wired to the existing
   draft/promote/confirm actions; **Free upgrade teaser / "Mejora a Pro" CTA** (reuse 11b
   `#pro-card` + billing i18n); new i18n namespace in EN + ES. **Boundary: web sends text + consumes
   the stream + renders only; no LLM imports; default mode is cosmetic — the server gate is the real
   enforcement; generation still flows through confirm.** If the SSE client (streaming consumer +
   abort/retry) plus the panel/toggle/teaser meaningfully exceeds ~200 authored lines, split the
   SSE-consumer transport from the panel/toggle/teaser wiring.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| LLM extraction non-determinism produces bad fields | High | Validate every extracted field against enums + `validateSessionDuration` before merge; Mock-based tests; fail-closed; deterministic clarifying questions |
| Health/limitation data leaking to LLM/observability | Med | `mask()` / `sanitizeMemoryContext` before LangChain/Langfuse; no raw-transcript vector embedding |
| deps-guard violation (LLM code leaking into web) | Med | All extraction/LLM code confined to `apps/api/src/ai/` behind a port; web sends text + renders only |
| Double-charging `plan_generation` | Med | Extraction turns consume no unit; generation only through the existing confirm gate |
| OD "Estructura"/"Nivel" fields don't map to `PlanSpec` | Med | Scope out of extraction; "Nivel"/experienceLevel read from `UserProfile` for prefill only |
| Draft state divergence between chat and wizard | Low | Single shared `plan_drafts` draft; `spec_json` is the one source of truth for both modes |
| Free bypass of the Pro gate via the client | High | Enforcement is the **endpoint entitlement gate**, not the UI; test that a Free token is rejected fail-closed regardless of client mode; the client default-mode toggle is cosmetic only |
| Tier/tenant spoofing via request body | Med | Tenant + tier always read from `authContext` + `resolveEffectiveTier`/entitlement port, never from the request body |
| Partial failure mid-stream corrupting the draft | Med | Commit + emit the merged draft **only on the terminal `draft` event**; on failure emit a terminal `error` event, client shows retry, draft untouched |
| SSE is net-new infra for this repo (transport correctness) | Med | Fastify `reply.raw`/hijack with correct `text/event-stream` headers; scoped to one route; deterministic Mock-based tests for the event sequence |
| Backpressure / long-running LLM stream timeouts | Med | Stream incrementally (no full buffering); sensible route/idle timeouts; terminal `error` event on timeout |
| Client disconnect / abort | Med | Honor `AbortSignal`; server stops the LLM stream and releases resources on client disconnect; no orphaned draft write |
| Proxy/CDN buffering breaking incremental delivery | Med | Disable response buffering (`X-Accel-Buffering: no` / correct cache/keep-alive headers); document infra expectations |
| Confusing chat stream with generation | Low | Chat SSE only carries assistant prose + the terminal draft; plan generation still runs via the existing async confirm → generate path + WsRegistry, never the chat stream |

## Rollback Plan

Purely additive. No schema migration and no change to existing endpoints or the confirm →
generate path, so rollback is unmerging per slice:
- Slice 3: remove the Asistente UI (SSE consumer) + i18n namespace; the Formulario wizard is
  unaffected.
- Slice 2 (or S2a/S2b): remove the SSE `POST /plan-specs/chat` route + adapter wiring;
  drafts/confirm/generate keep working exactly as before.
- Slice 1: contracts/domain/port additions are unused if slices 2–3 are reverted; drop them.
The wizard, drafts, and generation continue functioning at every rollback point.

## Relation to README roadmap

Implements roadmap item **12 — v1.1 interactive text chat**: conversational create-plan via text,
extracting a `PlanSpec` that feeds existing AI plan generation (08), building on the shared draft
model (07), the AI stack (08), and user memory seams (10a/10b). It precedes and is deliberately
bounded against item **13 — voice assistant** (STT/TTS), which is out of scope here.

## Dependencies

- 07 card wizard (drafts, promote, confirm) — merged.
- 08 AI plan generation + `apps/api/src/ai/` provider/adapter-factory — merged.
- 11a/11b billing `plan_generation` gate — merged (reused unchanged at confirm).
- 11b billing entitlement/visibility seam — `resolveEffectiveTier` (`apps/api/src/billing/entitlement.ts`) + the premium-gate convention (`MemoryRetrievalEntitlementPort` / CheckEntitlement) reused for the Pro gate and default-mode selection.
- Open Design `web-create-plan.html` MODE A "Asistente" as the authoritative web reference.

## Success Criteria

- [x] A free-text description produces a validated `Partial<PlanSpec>` draft covering the 6 input
      fields (+ optional name), never `preferenceScores`/`confirmed`.
- [x] The assistant reply streams token-by-token over SSE; the extracted `draftSpec` +
      `missingFields` arrive as the terminal `draft` event; a mid-stream failure emits a terminal
      `error` event without corrupting the draft.
- [x] Ambiguous/partial input yields deterministic clarifying questions instead of a bad draft.
- [x] A Free tenant calling `POST /plan-specs/chat` is rejected fail-closed with an
      upgrade-required denial regardless of client mode; a Pro tenant is allowed.
- [x] Create-plan defaults to Asistente for Pro and Formulario for Free, derived server-side;
      Free sees an Asistente teaser / "Mejora a Pro" CTA and cannot run chat turns.
- [x] Chat and wizard share one draft; toggling modes preserves the in-progress spec.
- [x] Generation runs only via the existing confirm gate and consumes exactly one
      `plan_generation` unit; extraction turns consume none.
- [x] No LLM/extraction code outside `apps/api/src/ai/` (deps-guard clean); web sends text + renders.
- [x] Health/limitation text is masked before reaching LLM/observability; no raw transcript embedded.
- [x] Web Asistente screen matches the OD layout; non-mapping OD fields scoped out or profile-read.
