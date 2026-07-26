# Exploration: 13-v1.1-interactive-voice-chat

**Status:** Not started. Only an empty canonical spec scaffold exists at `openspec/specs/13-v1.1-interactive-voice-chat/spec.md` — it already encodes constraints: STT MUST feed the transcribed text into the chat system; TTS is SHOULD (opt-out via settings); microphone permission MUST be requested and denial handled gracefully with a text fallback.

## What 13 is
A **voice layer over item 12's text chat**, not a new brain. The user speaks → Whisper transcribes to text → the SAME `PlanSpec` extraction turn that 12 shipped runs → the assistant prose is (optionally) spoken back via OpenAI TTS. It is the voice companion to 12's Asistente. Item 12 (interactive-text-chat) just shipped and is the entire foundation; 13 must **reuse, not duplicate** it.

## Current state (evidence-based)

### 1. Item 12 seams to reuse UNCHANGED
- **SSE chat endpoint** `POST /plan-specs/chat` — `apps/api/src/routes/plan.ts`. Registered only when both `chatEntitlement` and `chatExtractor` are wired. Order (fail-closed): `requireAuth()` → Pro gate → `reply.hijack()` + raw SSE headers → read shared draft → Pass 1 stream `token` frames → Pass 2 `extract` → `mergePlanSpecDraft` → commit-if-changed → terminal `draft { draftSpec, missingFields, assistantMessage }`. Backpressure-aware `writeFrame`, `AbortController` fired by client disconnect / ECONNRESET / wall-clock timeout. Consumes NO billing quota, does NO transcript embedding.
- **Extraction port + adapter** — `apps/api/src/ai/extraction-port.ts` (`PlanSpecExtractor.streamReply` + `.extract`), `extraction-adapter.ts` (LangChain `.stream()` prose Pass 1 + terminal `withStructuredOutput(PlanSpecDraftSchema, { method: "jsonSchema" })` Pass 2; provider resolved per-call from `ai_provider_config`, mirrors `DynamicPlanGenerator`).
- **Contracts** — `PlanSpecDraftSchema` / `PlanSpecDraft` / `PlanSpecDraftField` at `packages/contracts/src/index.ts`; extraction target is the 6 wizard INPUT fields only. Shared `plan_drafts` table. Promote → confirm → generate unchanged; **only `confirm` consumes `plan_generation`**.
- **Pro gate** — `apps/api/src/billing/chat-entitlement.ts` (`ChatEntitlementPort`/`ChatEntitlement`): fail-closed, Pro-only, tenant/user from `authContext` (never body), consumes nothing. Voice reuses this same gate.
- **Web Asistente** — `apps/web/src/app/(app)/create-plan/AssistantPane.tsx` (fetch + ReadableStream SSE reader, NOT EventSource; turn serialization; `AbortController` on unmount). SSE proxy `chat/route.ts` (same-origin, injects `kinora_session` Bearer, forwards `request.signal`). No LLM import on web.
- **Confinement** — `scripts/deps-guard.mjs` bans `openai|@ai-sdk|langchain|langfuse` outside `apps/api`. All voice LLM/audio calls MUST live in `apps/api/src/ai/`; web/mobile only ship audio bytes and play audio.

### 2. STT (Whisper) — API surface & where it lives
- OpenAI **transcription**: `POST /v1/audio/transcriptions`, multipart `file` + `model` (`whisper-1`, or newer `gpt-4o-transcribe` / `gpt-4o-mini-transcribe`). Single audio-file→text call. Practical limits: ~25 MB; formats mp3/mp4/mpeg/mpga/m4a/wav/webm. Optional `language`, `prompt`, `response_format`.
- **Critical infra gap:** the API depends on `@langchain/openai` only — **NOT the raw `openai` SDK**. LangChain `ChatOpenAI` does NOT expose Whisper/TTS. 13 must add the `openai` npm package to `apps/api` (deps-guard-clean — `openai` is an AI pattern and `apps/api` is AI-allowed) OR call the audio REST endpoints via `fetch`.
- **Provider mismatch:** Whisper/TTS are OpenAI-specific and DO NOT fit the dynamic multi-provider pattern (`ai_provider_config` → openrouter/anthropic/google/opencode-go, none do audio). STT/TTS ports need a **dedicated `OPENAI_API_KEY`**, independent of the resolved chat provider. Real design decision.
- **Where:** new port(s) in `apps/api/src/ai/` mirroring `PlanSpecExtractor` (e.g. `SpeechTranscriber.transcribe(audio, signal)`), LangChain-independent OpenAI-audio adapter + `Mock` for tests.
- **Browser capture:** `getUserMedia({ audio: true })` → `MediaRecorder` → `audio/webm;codecs=opus` (Chrome/FF) or `audio/mp4` (Safari) blob → upload. Push-to-talk → stop → one blob → transcribe.
- **How transcript feeds chat (recommended):** transcribe endpoint returns text; client then calls the EXISTING `/plan-specs/chat` with that text. Keeps the extraction/draft/gate path byte-identical to 12. (Alt: combined `voice-chat` endpoint that transcribes then delegates server-side — fewer round-trips, duplicates SSE plumbing.)

### 3. TTS (OpenAI) — API surface & playback
- `POST /v1/audio/speech`, `{ model, input, voice, response_format }`. Models `tts-1`/`tts-1-hd`/`gpt-4o-mini-tts`; formats mp3/opus/aac/flac/wav/pcm; `input` ~4096 char cap. Streamable audio body.
- **Playback:** simplest = fetch full blob → `URL.createObjectURL` → `<audio>`. Streaming = `MediaSource` chunked (net-new complexity).
- **Incremental vs after-turn:** chat emits prose token-by-token but TTS needs coherent text. Recommended v1: **speak after the turn completes** (TTS the terminal `assistantMessage`). Sentence-chunked incremental TTS later.
- **Autoplay:** browsers block audio without a user gesture; voice is mic-initiated so the first `.play()` is gesture-anchored — keep it so.

### 4. OD screen — "Asistente de voz" (`docs/open-design/kinora/screens/mobile-voice.html`)
- **MOBILE** frame (390×844), dark theme. Top bar (back, "Asistente kInorA", status `Listo`→`Escuchando`→`Procesando`→`kInorA responde`), central animated **voice orb** (pulsing rings + 9-bar waveform), **transcript** area (user + coach bubbles + typing indicator), bottom controls: keyboard/text-fallback button, center **push-to-talk mic** ("Mantener para hablar"/"Escuchando..."), red end-session button.
- The demo copy ("Sube el peso del press a 40 kilos" / "Actualicé tu press de banca…") depicts an *in-workout adjustment* assistant, NOT create-plan extraction. The spec ties 13 to plan definition (STT→chat→extraction). **Reconcile:** recommend honoring the spec/item-12 reuse (create-plan voice); treat OD copy as illustrative.
- Mobile screen, but item 12 is web-only — big platform fork (§5).

### 5. Platform scope — the biggest open decision
- `apps/mobile` is **Expo React Native** (`expo ~53`, `react-native 0.79.5`, react-navigation) — NOT literal Capacitor despite deps-guard's comment. It has **NO create-plan / chat flow** (only tracker/history/home/login/signup; `grep create-plan|PlanSpec` in apps/mobile = 0 hits).
- Item 12's chat foundation (SSE client, `AssistantPane`, same-origin proxy) is **web-only**. No RN chat UI/SSE reader/plan-draft client.
- The OD "mobile-voice" screen has **no host flow on mobile today**. Delivering it as designed means first porting the whole create-plan chat to RN — a large separate effort.
- **API is shared** — a new transcribe/TTS endpoint serves both web and mobile regardless.

| Platform option | Pros | Cons | Effort |
|---|---|---|---|
| **A. Web voice** (mic + STT + TTS in the existing web `AssistantPane`; OD orb adapted to web) | Builds on shipped item-12 web foundation; API reusable by mobile later; smallest blast radius; ships now | Diverges from OD *mobile* screen; PWA mic/audio quirks (iOS Safari) | Med |
| B. Mobile (Expo RN) voice — OD screen faithfully | Matches OD 1:1 | Must FIRST build the entire create-plan chat on RN; Expo mic + native audio | High |
| C. Both | Complete | Two UIs + RN foundation | Very High |

### 6. Privacy / security (reuse 12's discipline)
- Audio carries health + voice-biometric data. **MUST NOT persist raw audio** (transcribe in-flight, discard the blob). No raw-transcript vector embedding. Transcript flows through the existing `/plan-specs/chat`, which already masks known limitation terms — reusing that path inherits protection. Observability metadata safe-fields-only. Tenant/user scope from `authContext`; Pro gate on transcribe/voice endpoints, fail-closed. Record OpenAI audio API data-handling terms.

### 7. Billing
- Voice turns consume **no quota**, like text chat — only `confirm → generate` consumes `plan_generation`. STT (~$0.006/min) + TTS (~$15/1M chars) have real marginal cost; no new `BILLING_FEATURES` in v1; flag a future STT/TTS abuse meter.

## Approaches (STT/TTS integration)
| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. Thin transcribe endpoint + reuse `/plan-specs/chat`** (MediaRecorder → `POST /plan-specs/transcribe` → text → existing chat SSE → optional `POST /plan-specs/speech` on the reply) | Zero change to the proven extraction/draft/gate/SSE path; STT/TTS isolated + Mock-testable; smallest blast radius | Two extra round-trips per voice turn | Med |
| B. Combined `voice-chat` SSE endpoint (audio → transcribe → extractor → stream prose → stream TTS) | One round-trip | Duplicates SSE plumbing; multipart+SSE on one route awkward; drift risk vs 12 | High |
| C. Client-side Web Speech API STT | No server STT cost | Inconsistent support, worse accuracy, not the spec, no server masking | Rejected |

## Recommended first slice
**Web-only voice, Approach A.** (1) API: add `openai` SDK to `apps/api`; new `SpeechTranscriber` port + OpenAI-audio adapter + Mock in `apps/api/src/ai/`; `POST /plan-specs/transcribe` (auth, Pro gate, tenant-scoped, multipart audio → `{ text }`, no persistence); optional `POST /plan-specs/speech` (text → audio) behind a TTS preference; dedicated `OPENAI_API_KEY`. (2) Web: mic capture (getUserMedia + MediaRecorder, push-to-talk) + OD-inspired orb/listening states in `AssistantPane`; transcribed text fed into the EXISTING chat turn; reply optionally spoken via `<audio>` after the turn; mic-denied → text fallback. (3) i18n voice namespace (EN/ES parity). Confirm still runs the single `plan_generation` consume. Mobile (RN) voice deferred (requires an RN create-plan chat foundation first).

## Open questions a proposal must resolve
1. **Platform (BIGGEST):** web vs mobile vs both. (Recommend: web first.)
2. Endpoint shape: thin transcribe + reuse chat (recommended) vs combined voice-chat SSE.
3. Dedicated `OPENAI_API_KEY` for STT/TTS, decoupled from the dynamic chat provider.
4. STT model: `whisper-1` vs `gpt-4o-transcribe`/`mini`; EN/ES language; silence/noise → "Could not understand".
5. TTS: model/voice; stream vs play-after-turn (recommend after-turn v1); opt-out preference storage.
6. Interaction: push-to-talk vs continuous; barge-in (recommend out of scope v1).
7. Audio format/limits: webm/opus vs mp4 (Safari); max duration/size caps client + server.
8. UI placement: voice as a third mode vs a toggle within Asistente. (Recommend: affordance inside Asistente.)
9. Offline: voice requires network → degrade to text/disabled.
10. Reconcile OD demo copy (in-workout) vs spec (create-plan). Recommend: create-plan companion per spec.
11. Billing: confirm no per-turn meter v1; note future STT/TTS abuse meter.

## Risks
- Platform mismatch (mobile OD vs web-only foundation) → pick a platform explicitly; don't silently ship a diverging web UI without noting it.
- Missing `openai` SDK in the API → adding it is deps-guard-clean for apps/api; confirm no leak to web/mobile.
- Provider abstraction break — STT/TTS bypass `ai_provider_config`; dedicated OpenAI key required; document voice is OpenAI-only.
- iOS Safari MediaRecorder/autoplay PWA quirks → test capture format + gesture-anchored playback.
- Health/biometric audio → never persist raw audio; reuse masking + no-raw-transcript-embedding; Pro gate + tenant scope on every endpoint.
- STT/TTS cost with no meter → monitor; add abuse meter later.
- Double round-trip latency → acceptable v1; combined endpoint only if latency proves unacceptable.

## Next
`sdd-propose` — recommended first-slice scope above. Engram topic `sdd/13-v1.1-interactive-voice-chat/explore` (id 2403).
