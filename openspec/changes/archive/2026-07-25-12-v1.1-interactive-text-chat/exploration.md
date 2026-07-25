# Exploration: 12-v1.1-interactive-text-chat

**Status:** Not started. Only an empty canonical spec scaffold exists at `openspec/specs/12-v1.1-interactive-text-chat/spec.md` (it already encodes constraints: complements the v1 card wizard; no raw-transcript vector embedding by default; 10b bounded retrieval is not full chat memory).

## What 12 is
Conversational (text) create-plan: the user describes goals/constraints in natural language; the system extracts a structured `PlanSpec`, confirms it, then feeds the existing AI plan generation (08). A **companion to — not a replacement for** — the 07 card wizard. The OD "Asistente" screen already exists.

## Current state (evidence-based)

### 1. The `PlanSpec` contract — chat must produce this EXACT shape
`packages/contracts/src/index.ts:323`:
```
PlanSpec { goal: PlanGoal; daysPerWeek: number; sessionDurationMinutes: number;
           location: TrainingLocation; equipment: string[]; limitations: PlanLimitation[];
           preferenceScores: PlanPreferenceScores; confirmed: boolean; name?: string|null }
```
- `PlanGoal` = strength|hypertrophy|fat_loss|general_fitness; `TrainingLocation` = home|gym|outdoor.
- `PlanLimitation = { text; isWarning }`; `PlanPreferenceScores = { strength, hypertrophy, endurance, mobility }` in [0,1].
- **Key seam:** `preferenceScores` is NOT user/LLM-supplied — it is DERIVED server-side by the pure `derivePreferenceScores(spec)` (`packages/domain/src/plan/derive-preference-scores.ts:31`) from the 6 input fields. `sessionDurationMinutes` bounds are 15–240 via `validateSessionDuration` (`packages/domain/src/plan/session-duration.ts`). So the chat's extraction target is the **6 wizard INPUT fields only** (goal, daysPerWeek, sessionDurationMinutes, location, equipment, limitations) + optional `name`. It MUST NOT extract preferenceScores or confirmed.

### 2. The 07 wizard flow (reuse, don't duplicate) — `apps/api/src/routes/plan.ts`
- `POST /plan-specs/drafts` + `GET /plan-specs/drafts/current` — durable draft `{ step, spec: Partial<PlanSpec> }` via `PlanDraftRepository` (tenant+user scoped, one active draft).
- `POST /plan-specs` — promote: `assertPlanSpecInput` → `derivePreferenceScores` → `assertPlanSpecShape` → insert confirmed `plan_specs` row + delete draft atomically.
- `POST /plan-specs/:id/confirm` — `generationService.assertGeneratable` → **consume `plan_generation` quota** → `startGeneration`. Boundary validators shared with 08 at `apps/api/src/plan/boundary.ts`.
- Web: `create-plan/page.tsx` (server; loads draft + profile + preferences), `StepperShell.tsx` (client; prefills from profile+preferences via `applyInitialPrefill`), `plan-draft-client.ts`, `actions.ts` (bearer token from `kinora_session` cookie).
- **Implication:** chat can share the same `plan_drafts` table (`spec_json` is `Partial<PlanSpec>`) and the same promote → confirm → generate endpoints unchanged. Only new surface = an **extraction step** turning free text into a merged `Partial<PlanSpec>` draft.

### 3. AI stack to reuse (08 + dynamic-generator)
- Port `PlanGenerator` (`apps/api/src/ai/port.ts`); `DynamicPlanGenerator` reads active provider config per call (`ai_provider_config`), falls back to openrouter.
- `adapter-factory.ts` — openrouter/openai/anthropic/google/opencode-go via LangChain `.withStructuredOutput(schema, { method: "jsonSchema" })`. OpenRouter = `ChatOpenAI` + `baseURL https://openrouter.ai/api/v1`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`).
- `buildPlanPrompt` (`apps/api/src/ai/prompt.ts`) is PURE, accepts `memoryContext?: string[]` + `sanitizeMemoryContext`; `mask()` redacts limitation/health text before it reaches LangChain/Langfuse. `MockPlanGenerator` exists for tests.
- **No streaming today** — synchronous `chain.invoke()`; generation runs fire-and-forget in `runGenerationTask`, notifies via WsRegistry (`{ planId, status }`).
- **Confinement:** `scripts/deps-guard.mjs` bans `openai|langchain|langfuse|ai-sdk` outside `apps/api`. The extraction LLM call MUST live in `apps/api/src/ai/` behind a new port; web only sends text + renders results.

### 4. User memory (personalization seams)
- Structured (10a): `GET/PUT /user-profile` (name, goal, experienceLevel) and `/user-preferences` (defaultLocation/defaultDuration/defaultEquipment). Chat can seed opening extraction from both, like the wizard.
- Vector (10b): `VectorMemoryRetriever.retrieve` — embeds query, `searchActiveCompatible`, **fail-open**. Gated by `MemoryRetrievalEntitlementPort` (premium; Free `memory_retrieval` = 0). `generation-service.ts attachMemoryContext` is the reference pattern. Spec: chat MUST NOT embed raw transcripts by default.

### 5. Open Design — "Asistente" screen ALREADY exists
`docs/open-design/kinora/screens/web-create-plan.html` MODE A "Asistente": two-column layout — left chat thread ("Entrenador kInorA / IA · Disponible ahora", `.msg.ai`/`.msg.user`, input row + send), right **"Datos extraídos"** panel (one editable row per field: Objetivo, Días/semana, Nivel, Equipo, Lesiones, Estructura) + **"Generar plan"** primary button. Mode toggle `btn-asistente`/`btn-formulario`; MODE B "Formulario" is what the 07 wizard overrode. Authoritative UI to respect (as billing screen was in 11b). `mobile-voice.html` = "Asistente de voz" belongs to **item 13**, not 12.
- Caveat: OD panel fields "Estructura"/"Nivel" don't map cleanly to the current `PlanSpec` (no split/experienceLevel on PlanSpec; experienceLevel lives on UserProfile) → proposal must map or scope them out.

### 6. i18n pattern
next-intl nested JSON catalogs `packages/i18n/src/messages/{en,es}.json`, re-exported via `packages/i18n/src/index.ts`. `useTranslations()`/`getTranslations()`; `MessageKey` compile-time union; `validateCatalogParity` + `catalog-parity.test.ts` enforce EN/ES parity. New chat copy → a new namespace in BOTH catalogs.

### 7. Architecture constraints shaping the design
Hexagonal (extraction use case pure, LLM behind a new port; web never imports LLM libs); tenant scoping via `requireAuth()` authContext (never body); billing reuse the existing `plan_generation` gate at confirm (Free 1/mo, Pro 500); fail-closed on LLM error for generation, fail-open for optional memory retrieval.

## Approaches (extraction mechanism)
| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. Per-turn structured-output extraction** (LLM → `Partial<PlanSpec>` via `withStructuredOutput` + a new Zod `PlanSpecDraftSchema`), merged into the existing draft; deterministic clarifying questions when fields missing | Reuses proven jsonSchema pattern; testable with Mock; draft persistence exists; small blast radius | Needs new extraction port/adapter + prompt; enum/bounds validation on extracted fields | Med |
| B. Tool-calling agent owning multi-turn state | Rich dialog | Heavier; provider-compat risk; harder to test deterministically | High |
| C. Turn-based vs SSE streaming | Turn-based matches 08's sync model, simplest client | Streaming nicer but net-new infra | Turn Low / SSE High |

**Recommended first slice:** Approach A, turn-based (no streaming), reusing `plan_drafts` + promote/confirm/generate unchanged. New: one `apps/api/src/ai/` extraction port + adapter + pure prompt + `PlanSpecDraftSchema`; one `POST /plan-specs/chat` route (auth, tenant-scoped, fail-closed) returning `{ assistantMessage, draftSpec, missingFields }`; web chat pane + extracted-data panel wired to the existing draft/confirm actions; new i18n namespace. Confirm still runs the single `plan_generation` consume.

## Open questions a proposal must resolve
1. **Replace vs complement** — spec says complement; confirm a mode toggle (Asistente/Formulario) sharing one draft. (Recommend: complement + shared `plan_drafts`.)
2. **Extraction cost/quota** — does a chat/extraction turn consume a billing unit? (Recommend: no; only final confirm consumes `plan_generation`; add a separate meter later if abuse appears.)
3. **Structured extraction contract** — define `PlanSpecDraftSchema` (Partial, enum-validated, duration 15–240); partial/ambiguous turns → clarifying questions (deterministic missing-field prompts vs LLM-driven).
4. **Streaming vs turn-based** — v1 turn-based (no SSE infra exists) vs invest in streaming now.
5. **Multi-turn state** — reuse `plan_drafts.spec_json` (recommended) vs a new conversation table; and whether/where transcript is stored (spec forbids raw-transcript vector embedding by default).
6. **Edit path** — OD panel per-field edit: reuse wizard step components inline vs new inline editors.
7. **Scope boundary vs 13 (voice)** — text only; voice STT/TTS deferred to 13.

## Risks
- LLM extraction non-determinism → validate every extracted field against enums + `validateSessionDuration` before merging; Mock tests; fail-closed.
- Health data in transcripts → apply `mask()`/`sanitizeMemoryContext`; honor no-raw-transcript-embedding rule.
- deps-guard violation if LLM/extraction code leaks into web → keep all LLM calls in `apps/api/src/ai/`.
- Double-charging `plan_generation` if chat adds its own consume → route generation only through the existing confirm gate.
- OD "Estructura"/"Nivel" panel fields don't map to current `PlanSpec` → map or scope out.

## Next
`sdd-propose` — recommended first-slice scope above. Engram topic `sdd/12-v1.1-interactive-text-chat/explore` (id 2395).
