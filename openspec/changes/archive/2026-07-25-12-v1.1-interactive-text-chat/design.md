# Design: 12 — Interactive Text Chat (v1.1 conversational create-plan)

## Technical Approach

Chat adds exactly ONE new capability — a per-turn extraction step that turns free text into a
merged `Partial<PlanSpec>` — bolted onto seams that already exist. The extraction LLM call lives
behind a NEW hexagonal port in `apps/api/src/ai/` mirroring `PlanGenerator` (`port.ts:12`); the
merge/validation is a pure domain function; the draft persists to the SAME `plan_drafts` the wizard
uses (`PlanRouteRepo.upsertDraft`, `plan.ts:50`); promote → confirm → generate is untouched. The
Pro gate reuses the billing entitlement seam (`resolveEffectiveTier`, `entitlement.ts:68`). Net-new
infra is limited to SSE transport on one route. Sliced S1 (contracts/domain/port) → S2 (SSE route +
gate) → S3 (web).

## Architecture Decisions

### Decision: SSE via Fastify `reply.hijack()` + `reply.raw`
**Choice**: `POST /plan-specs/chat` calls `reply.hijack()`, writes SSE frames to `reply.raw` with
headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`,
`X-Accel-Buffering: no`. Events: repeated `token`/`message` deltas, one terminal `draft`
(`{draftSpec, missingFields, assistantMessage}`), or a terminal `error`.
**Alternatives**: reuse the generation WebSocket (`WsRegistry`) — **rejected**: WsRegistry is a
fire-and-forget notify channel for async generation (`{planId,status}`), not a request-scoped
response body; a chat turn is a synchronous request/response. Turn-based JSON (exploration option C)
— **rejected**: loses the OD token-by-token UX that is the point of the Asistente screen.
**Rationale**: one route, no new dependency, correct incremental delivery; `X-Accel-Buffering`
defeats proxy buffering.

### Decision: Streamed prose + terminal structured-extraction (two passes)
**Choice**: Pass 1 streams the assistant prose token-by-token via LangChain `.stream()`. Pass 2 is
the terminal, non-streamed extraction using the proven
`withStructuredOutput(PlanSpecDraftSchema, { method: "jsonSchema" })` pattern
(`adapter-factory.ts:76`), emitted as the terminal `draft` event.
**Alternatives**: single structured pass (no prose stream) — **rejected**: no incremental UX;
stream partial structured JSON — **rejected**: `withStructuredOutput` does not reliably stream
partial JSON and provider compat varies.
**Rationale**: keeps the battle-tested jsonSchema contract for the data that must be valid, while
still streaming prose. The draft is committed to `plan_drafts` ONLY after Pass 2 succeeds, so a
mid-stream failure never corrupts the draft.

### Decision: Free denial returns **403** (not 402)
**Choice**: A Free tenant is rejected `403 { error: "premium_required" }` (or the specific
`lapsedReason`: `trial_expired` / `subscription_ended`).
**Alternatives**: 402 Payment Required — **rejected**: 402 appears NOWHERE in this codebase; every
existing entitlement/premium denial is 403 — `plan.ts:315/352` (confirm/regenerate) and
`billing.ts:121 denialStatus()` both map `BillingDenialReason` → 403, and the web already reads
`403 + reason`. **Rationale**: consistency with the shipped `BillingDenialReason` → 403 convention;
the upgrade semantics live in the reason string, not the status code. Introducing 402 for one route
would fork the web's denial handling for no gain.

### Decision: Tier-based gate, NOT a new billing meter
**Choice**: A `ChatEntitlementPort` (in `apps/api/src/billing`, mirroring
`MemoryRetrievalEntitlementPort`, `memory-retriever.ts:58`) loads the entitlement context and allows
only when `resolveEffectiveTier(ctx, now).tier === "pro"`. It consumes NO quota and adds NO entry to
`BILLING_FEATURES`.
**Rationale**: chat/extraction turns are explicitly free of quota (proposal); the Pro gate replaces
a per-turn meter in v1. Reusing `resolveEffectiveTier` keeps the source of truth single and
server-side.

## Data Flow

    client ── POST /plan-specs/chat {message} (Bearer) ──▶ Fastify route
      │ requireAuth → authContext (tenant/user; NEVER body)
      │ ChatEntitlementPort.check → resolveEffectiveTier === pro?  ──no──▶ 403 premium_required
      │ yes → reply.hijack(); write SSE headers
      │ mask()/sanitizeMemoryContext(message + draft limitations)
      │ Pass 1: extractor.streamReply() ──▶ token/message deltas ──▶ reply.raw
      │ Pass 2: extractor.extract() → PlanSpecDraft (withStructuredOutput)
      │ mergePlanSpecDraft(currentDraft, extracted) → {draft, missingFields}  [pure domain]
      │ repo.upsertDraft(tenant,user,step,draft)   ◀── shared plan_drafts, atomic
      └ terminal event: draft {draftSpec, missingFields, assistantMessage}  | on any error: error event, draft untouched

Client disconnect → `request.raw.on("close")` fires an `AbortController`; the LLM stream is aborted
and `reply.raw` ended; no draft write.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | Modify | `PlanSpecDraftSchema` (Zod) + `PlanSpecDraft` type + chat request DTO + SSE event DTOs (S1) |
| `packages/domain/src/plan/merge-plan-spec-draft.ts` | Create | pure merge + per-field re-validation + `missingFields` (S1) |
| `apps/api/src/ai/extraction-port.ts` | Create | `PlanSpecExtractor` port (mirrors `port.ts`) (S1) |
| `apps/api/src/ai/extraction-prompt.ts` | Create | pure `buildExtractionPrompt` (mirrors `prompt.ts`, uses `mask`/`sanitizeMemoryContext`) (S1) |
| `apps/api/src/ai/mock-extractor.ts` | Create | deterministic `MockPlanSpecExtractor` for tests (S1) |
| `apps/api/src/ai/extraction-adapter.ts` | Create | LangChain `.stream()` + terminal `withStructuredOutput` adapter (S2) |
| `apps/api/src/billing/chat-entitlement.ts` | Create | `ChatEntitlementPort` (tier-based, reuses `resolveEffectiveTier`) (S2) |
| `apps/api/src/routes/plan.ts` | Modify | SSE `POST /plan-specs/chat` (auth, tenant-scoped, Pro-gated, fail-closed) (S2) |
| `apps/api/src/app.ts` | Modify | wire extractor adapter + chat gate (S2) |
| `apps/web/.../create-plan/page.tsx` | Modify | server-fetch billing visibility → default mode (S3) |
| `apps/web/.../create-plan/*` | Create | Asistente chat pane (SSE consumer), "Datos extraídos" panel, mode toggle, Free teaser (S3) |
| `packages/i18n/src/messages/{en,es}.json` | Modify | new `chat` namespace, EN/ES parity (S3) |

## Interfaces / Contracts

```typescript
// packages/contracts — Zod. Hardcodes 15/240 (contracts cannot import domain;
// keep in sync with SESSION_DURATION_LIMITS — noted as a coupling).
export const PlanSpecDraftSchema = z.object({
  goal: z.enum(["strength","hypertrophy","fat_loss","general_fitness"]).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  sessionDurationMinutes: z.number().int().min(15).max(240).optional(),
  location: z.enum(["home","gym","outdoor"]).optional(),
  equipment: z.array(z.string()).optional(),
  limitations: z.array(z.object({ text: z.string(), isWarning: z.boolean() })).optional(),
  name: z.string().nullable().optional(),
}); // NEVER preferenceScores/confirmed — those stay server-derived (derivePreferenceScores)

export interface PlanSpecExtractor {          // mirrors PlanGenerator
  streamReply(input: ChatExtractInput, signal: AbortSignal): AsyncIterable<string>;
  extract(input: ChatExtractInput): Promise<PlanSpecDraft>;
}
export interface ChatEntitlementPort { check(scope): Promise<{ allowed: boolean; reason?: BillingDenialReason }>; }
```

`mergePlanSpecDraft(current, extracted)`: re-validate each extracted field against its enum +
`validateSessionDuration`; drop invalids silently; merge survivors onto `current`; `missingFields` =
the 6 input fields still absent → drives deterministic clarifying questions.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (domain) | merge drops invalid enum/duration; `missingFields`; never writes preferenceScores/confirmed | pure fn + fixtures |
| Unit (contracts) | `PlanSpecDraftSchema` enum/bounds; rejects preferenceScores | Zod parse cases |
| Unit (ai) | prompt masking; `MockPlanSpecExtractor` determinism | Mock, no network |
| API | Free→403 `premium_required` / Pro→allowed; SSE event sequence (token…→terminal draft); error event leaves draft untouched; tenant from authContext | `buildTestApp` + mock stream extractor + fake entitlement reader |
| Web | default mode = Asistente(Pro)/Formulario(Free); Free teaser + `#pro-card` CTA; incremental render; abort on unmount | component tests, mocked ReadableStream |
| E2E | (later) full chat→panel→confirm | deferred |

## Threat Matrix

Applicable — a new authenticated streaming route with LLM/process integration and a premium gate.

| Row | Applicable | Safe/failure behavior | RED test |
|-----|-----------|-----------------------|----------|
| Free bypass via client mode | Yes | endpoint gate denies 403 regardless of client mode | Free token → 403 |
| Tier/tenant spoof via body | Yes | tenant+tier from authContext/`resolveEffectiveTier` only | body-injected tenantId ignored |
| Health/limitation leak to LLM/observability | Yes | `mask()`/`sanitizeMemoryContext` before LangChain/Langfuse | masked-prompt assertion |
| Raw-transcript embedding | Yes (N/A write) | transcripts NEVER embedded; state only in `plan_drafts` | no vector-write on chat turn |
| Mid-stream failure corrupts draft | Yes | draft committed only on terminal `draft`; else `error`, draft untouched | injected Pass-2 failure |
| Client disconnect / abort | Yes | `AbortSignal` stops LLM; no orphaned write | close event mid-stream |
| deps-guard leak (LLM in web) | Yes | all LLM code in `apps/api/src/ai/`; web sends text + renders | deps-guard clean |

## Migration / Rollout

No migration — purely additive; reuses `plan_drafts`; no change to existing endpoints or the
confirm → generate path. Rollback per slice: S3 remove UI+i18n (Formulario unaffected); S2 remove
the route+adapter+gate (drafts/confirm/generate unchanged); S1 drop unused contracts/domain/port.
If S2 exceeds ~200 authored lines, split S2a (transport + Pro gate + fail-closed lifecycle) / S2b
(terminal structured extraction + masking).

## Open Questions

- [x] Confirm `X-Accel-Buffering: no` + keep-alive suffice for the deployed proxy/CDN. (Confirmed adequate; no proxy buffering issue observed across S2a/S2b implementation and testing.)
- [x] Web SSE consumer confirmed as fetch+ReadableStream (EventSource cannot POST nor send the
      `Authorization: Bearer` header) — pinned to fetch+ReadableStream. Implemented in S3 via a same-origin `chat/route.ts` proxy forwarding the Bearer token.
