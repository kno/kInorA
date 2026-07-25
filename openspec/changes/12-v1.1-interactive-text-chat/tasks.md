# Tasks: 12 — Interactive Text Chat (v1.1 conversational create-plan)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~650–850 across 4 slices (~150–220 each) |
| 400-line budget risk | Low (per-slice); slices chain to more than 400 in aggregate |
| Chained PRs recommended | Yes |
| Suggested split | PR1 S1 contracts/domain/port → PR2 S2a SSE transport+gate → PR3 S2b extraction+masking → PR4 S3 web UI |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — ask the user (stacked-to-main vs feature-branch-chain) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Low

S2 is split into S2a/S2b per design (transport+gate exceeds ~200 lines combined with extraction+masking). S2/S2b sit on the auth+LLM+streaming hot path → treat as high-risk (full 4R) at review time regardless of per-slice line count.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | `PlanSpecDraftSchema` + pure merge/validation domain fn + extraction port/prompt/Mock. No route, no web, no streaming | PR1 | `pnpm --filter contracts test` + `pnpm --filter domain test -- merge-plan-spec-draft` + `pnpm --filter api test -- src/ai/__tests__` | N/A — pure functions, no I/O to smoke | `packages/contracts/src/index.ts`, `packages/domain/src/plan/merge-plan-spec-draft.ts`, `apps/api/src/ai/{extraction-port,extraction-prompt,mock-extractor}.ts` — unused if PR2+ revert |
| 2 | SSE transport (`reply.hijack`/`reply.raw` headers) + `ChatEntitlementPort` Pro gate (fail-closed, authContext-only) + abort/disconnect lifecycle | PR2 | `pnpm --filter api test -- src/routes/__tests__/plan-chat.test.ts src/billing/__tests__/chat-entitlement.test.ts` | `pnpm --filter api dev` + curl SSE smoke (Free 403, Pro 200 headers, close mid-stream) | `apps/api/src/routes/plan.ts` (chat route scope), `apps/api/src/billing/chat-entitlement.ts` — drop route, drafts/confirm unaffected |
| 3 | LangChain `.stream()` prose + terminal `withStructuredOutput` extraction + masking + draft commit only on terminal event | PR3 | `pnpm --filter api test -- src/ai/__tests__/extraction-adapter.test.ts src/routes/__tests__/plan-chat.test.ts` | `pnpm --filter api dev` + real-provider smoke (or Mock) proving token stream then terminal `draft` | `apps/api/src/ai/extraction-adapter.ts`, adapter wiring in `apps/api/src/app.ts` — drop adapter, gate/transport still deny cleanly |
| 4 | Tier-based default mode + Asistente SSE consumer + "Datos extraídos" panel + mode toggle + Free teaser + i18n | PR4 | `pnpm --filter web test -- src/app/.../create-plan` + `pnpm --filter i18n test` | `pnpm --filter web dev` on create-plan: Pro default Asistente, Free teaser+CTA, stream render, abort on unmount | `apps/web/.../create-plan/*` (chat pane, panel, toggle, teaser), `packages/i18n/src/messages/{en,es}.json` — Formulario wizard unaffected |

## Phase 1: Slice 1 — Contracts + Domain + Extraction Port (pure, no streaming) [Requirements: Conversational Plan Definition]

- [x] 1.1 RED: Add failing `packages/contracts/src/__tests__/plan-spec-draft-schema.test.ts` asserting `PlanSpecDraftSchema` accepts the 6 input fields + optional `name`, enforces `goal`/`location` enums, `sessionDurationMinutes` bounded 15–240, and has NO `preferenceScores`/`confirmed` keys.
- [x] 1.2 GREEN: Add `PlanSpecDraftSchema` + `PlanSpecDraft` type to `packages/contracts/src/index.ts` (hardcoded 15/240 bound, code comment noting sync with domain `SESSION_DURATION_LIMITS`).
- [x] 1.3 RED: Add failing `packages/domain/src/plan/__tests__/merge-plan-spec-draft.test.ts`: valid full extraction merges all 6 fields; invalid enum/out-of-range duration dropped silently (draft unchanged for that field); `missingFields` lists absent input fields; `preferenceScores`/`confirmed` never written.
- [x] 1.4 GREEN: Create `packages/domain/src/plan/merge-plan-spec-draft.ts` — pure `mergePlanSpecDraft(current, extracted)` re-validating each field against `PlanGoal`/`TrainingLocation`/`validateSessionDuration` before merge, computing `missingFields`.
- [x] 1.5 RED: Add failing `apps/api/src/ai/__tests__/extraction-prompt.test.ts` asserting `buildExtractionPrompt` masks limitation/health text via `mask()`/`sanitizeMemoryContext` before including it in the prompt string.
- [x] 1.6 GREEN: Create `apps/api/src/ai/extraction-port.ts` (`PlanSpecExtractor` interface mirroring `PlanGenerator`) and `apps/api/src/ai/extraction-prompt.ts` (pure prompt builder with masking).
- [x] 1.7 RED: Add failing `apps/api/src/ai/__tests__/mock-extractor.test.ts` asserting `MockPlanSpecExtractor` returns deterministic `streamReply`/`extract` output for fixed inputs (no network).
- [x] 1.8 GREEN: Create `apps/api/src/ai/mock-extractor.ts` implementing `PlanSpecExtractor` deterministically.
- [x] 1.9 TRIANGLE: Run `pnpm --filter contracts test && pnpm --filter domain test && pnpm --filter api test -- src/ai/__tests__` green; `pnpm -w typecheck`; confirm zero HTTP/web/streaming touch (grep diff for route/UI files).

## Phase 2: Slice 2a — SSE Transport + Pro Gate + Fail-Closed Lifecycle [Requirements: Streaming Chat Endpoint (SSE), Pro-Only Chat Gate (Fail-Closed)]

- [x] 2.1 RED: Add failing `apps/api/src/billing/__tests__/chat-entitlement.test.ts` (Threat Matrix rows: Free bypass via client mode, tier/tenant spoof via body): Pro tenant → allowed; Free tenant → denied before any work; expired-trial tenant → denied; body-injected `tenantId`/`tier` ignored, resolved only from `authContext`.
- [x] 2.2 GREEN: Create `apps/api/src/billing/chat-entitlement.ts` (`ChatEntitlementPort`, mirrors `MemoryRetrievalEntitlementPort`) — `check(scope)` returns `{allowed, reason?}` from `resolveEffectiveTier(ctx, now).tier === "pro"`; consumes no quota, adds no `BILLING_FEATURES` entry.
- [x] 2.3 RED: Add failing `apps/api/src/routes/__tests__/plan-chat.test.ts` covering: Free → `403 {error:"premium_required"}` before any LLM call; Pro → SSE headers (`text/event-stream`, `no-cache`, `keep-alive`, `X-Accel-Buffering: no`) and a deterministic mock token/message/terminal-draft event sequence; client `close` mid-stream (Threat Matrix: disconnect/abort) stops the stream and writes no draft.
- [x] 2.4 GREEN: Add `POST /plan-specs/chat` to `apps/api/src/routes/plan.ts` — `requireAuth` → `ChatEntitlementPort.check` (fail-closed before `reply.hijack()`) → on pass, `reply.hijack()` + SSE headers on `reply.raw`; wire `request.raw.on("close")` to an `AbortController` that halts the extractor and ends the response with no draft write.
- [x] 2.5 GREEN: Wire `ChatEntitlementPort` + a stub/Mock `PlanSpecExtractor` into `apps/api/src/app.ts` for this slice (real adapter arrives in S2b); route emits `token` deltas from the injected extractor's `streamReply` only — no terminal `draft`/extraction logic yet (stubbed pass-through, kept minimal to bound this slice).
- [x] 2.6 TRIANGLE: Run `pnpm --filter api test -- src/routes/__tests__/plan-chat.test.ts src/billing/__tests__/chat-entitlement.test.ts` green; manual SSE smoke via `pnpm --filter api dev` (curl with Free/Pro tokens, verify headers + close-before-body-write); confirm no route path allows LLM work before the gate check.

## Phase 3: Slice 2b — Structured Extraction Terminal Event + Masking [Requirements: Streaming Chat Endpoint (SSE), Conversational Plan Definition, Privacy and Data Protection, Chat Billing Boundary]

- [ ] 3.1 RED: Extend `apps/api/src/routes/__tests__/plan-chat.test.ts` (or new `extraction-adapter.test.ts`): valid message → prose deltas then terminal `draft` event with `{draftSpec, missingFields, assistantMessage}`; injected Pass-2 (extraction) failure (Threat Matrix: mid-stream failure) → terminal `error` event, draft in `plan_drafts` left byte-for-byte unchanged; empty/whitespace input → no LLM call, clarifying prompt only.
- [ ] 3.2 RED: Add failing masking assertion (Threat Matrix: health/limitation leak) — a turn containing limitation text produces a prompt/observability payload with the sensitive text masked via `mask()`/`sanitizeMemoryContext`, verified against the LangChain/Langfuse call args in the test double.
- [ ] 3.3 RED: Add failing no-embedding assertion (Threat Matrix: raw-transcript embedding) — a completed chat turn triggers no vector-store write.
- [ ] 3.4 GREEN: Create `apps/api/src/ai/extraction-adapter.ts` — Pass 1 `streamReply()` via LangChain `.stream()`; Pass 2 `extract()` via `withStructuredOutput(PlanSpecDraftSchema, {method:"jsonSchema"})`; applies masking from S1's `extraction-prompt.ts` before any LLM/Langfuse call.
- [ ] 3.5 GREEN: Complete the `POST /plan-specs/chat` handler in `apps/api/src/routes/plan.ts` — after Pass 1 completes, run Pass 2, call `mergePlanSpecDraft` (S1), `repo.upsertDraft` (commit only here), then emit terminal `draft`; any Pass-1/Pass-2 error emits terminal `error` with the draft untouched. Confirm no `plan_generation` consumption anywhere in this path.
- [ ] 3.6 GREEN: Swap `apps/api/src/app.ts` wiring from the S2a stub extractor to the real `extraction-adapter.ts` (Mock stays available for tests).
- [ ] 3.7 TRIANGLE: Run the full `apps/api` chat suite green; confirm draft is committed exactly once and only on the terminal event (assert `upsertDraft` call count/timing in tests); confirm `deps-guard`-relevant imports (`langchain`/provider SDK) stay inside `apps/api/src/ai/`.

## Phase 4: Slice 3 — Web Asistente SSE Consumer + Tier Default + Teaser + i18n [Requirements: Shared Plan Draft Across Modes, Tier-Based Default Mode and Free Teaser, PlanSpec Edit Before Generation]

- [ ] 4.1 RED: Add failing component test for create-plan server component: Pro effective tier (reusing 11b billing-visibility fetch) → default mode Asistente; Free → default mode Formulario + Asistente teaser/"Mejora a Pro" CTA (reusing `#pro-card`) rendered; Free cannot trigger a chat turn.
- [ ] 4.2 GREEN: Modify `apps/web/.../create-plan/page.tsx` to derive effective tier server-side (reuse existing billing-visibility loader) and pass default mode + teaser flag to the client component.
- [ ] 4.3 RED: Add failing SSE-consumer test (mocked `ReadableStream`) for incremental token render, terminal `draft` event populating the "Datos extraídos" panel, mid-stream error showing a retry affordance without losing prior draft state, and `AbortController.abort()` firing on component unmount (deps-guard: no `langchain|openai|langfuse|ai-sdk` import in this module).
- [ ] 4.4 GREEN: Create the Asistente chat pane consuming `POST /plan-specs/chat` via `fetch` + `ReadableStream` (not `EventSource` — needs POST + `Authorization` header), rendering incremental assistant text, updating local state from the terminal `draft` event, and aborting on unmount/navigation.
- [ ] 4.5 GREEN: Create the "Datos extraídos" per-field review/edit panel (populate from terminal event, edits persist to the shared draft via existing draft-update calls) and the `btn-asistente`/`btn-formulario` mode toggle wired to the existing draft/promote/confirm actions — no new generation entry point.
- [ ] 4.6 GREEN: Add the `chat` i18n namespace to `packages/i18n/src/messages/{en,es}.json` (assistant copy, clarifying-question strings, teaser/CTA copy) with EN/ES key parity.
- [ ] 4.7 TRIANGLE: Run `pnpm --filter web test -- src/app/.../create-plan` + `pnpm --filter i18n test` green; run `scripts/deps-guard.mjs` clean; manual smoke on `pnpm --filter web dev` (Pro default Asistente end-to-end to "Generar plan", Free teaser path, mode toggle preserves draft); confirm OD layout parity and non-mapping fields ("Estructura"/"Nivel") scoped out or profile-read-only.
