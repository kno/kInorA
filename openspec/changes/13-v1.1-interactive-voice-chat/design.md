# Design: 13 — Interactive Voice Chat (v1.1 voice companion to create-plan)

## Technical Approach

Voice adds exactly TWO new server capabilities — speech→text and text→speech — bolted onto the
proven item-12 chat seams, plus voice UI on web and a net-new RN create-plan chat foundation on
mobile. Both audio calls live behind NEW hexagonal ports in `apps/api/src/ai/` mirroring
`PlanSpecExtractor` (`extraction-port.ts:35`) and `PlanGenerator` (`port.ts`), each with a
LangChain-independent OpenAI-audio adapter and a deterministic Mock. The transcript feeds the
**existing** `POST /plan-specs/chat` SSE turn (`plan.ts:552`) byte-for-byte — extraction, the pure
`mergePlanSpecDraft`, the shared `plan_drafts` commit, and the confirm→generate gate are untouched.
The Pro gate reuses `ChatEntitlementPort` (`chat-entitlement.ts:28`) fail-closed on every new
endpoint. STT/TTS use a **dedicated `OPENAI_API_KEY`**, decoupled from the dynamic
`ai_provider_config` (which resolves openrouter/anthropic/google/opencode-go — none do audio).

Net-new infra is limited to: the `openai` npm SDK in `apps/api` only (deps-guard-clean —
`AI_ALLOWED_WORKSPACES = ["apps/api"]`, `deps-guard.mjs:71`); two thin routes on `plan.ts`; one
nullable `tts_enabled` column on `user_preferences`; web mic/orb/audio affordances in
`AssistantPane`; and — the bulk — an RN port of the item-12 chat (plan-draft client, SSE reader,
Asistente/extraction UI) before mobile voice can exist at all.

Sequenced across four tracks: **A** (shared API) and **C** (RN chat foundation) proceed in
parallel; **B** (web voice) depends on A; **D** (mobile voice) depends on A and C.

## Architecture Decisions

### Decision: Thin `POST /plan-specs/transcribe` + reuse `/plan-specs/chat` (Approach A)
**Choice**: The client records push-to-talk audio, uploads it multipart to a new
`POST /plan-specs/transcribe` returning `{ text }`, then feeds that text into the **existing**
`POST /plan-specs/chat` SSE turn unchanged. The optional `POST /plan-specs/speech` converts the
terminal `assistantMessage` to audio for after-turn playback.
**Alternatives**: a combined `voice-chat` SSE endpoint (audio in → transcribe → extractor → stream
prose → stream TTS) — **rejected**: it duplicates the entire SSE lifecycle already implemented in
`plan.ts:552-760` (hijack, backpressure `writeFrame`, `AbortController` on close/ECONNRESET/timeout,
commit-if-changed), forcing multipart + SSE onto one awkward route and creating drift risk against
the shipped item-12 path. Client-side Web Speech API STT — **rejected**: inconsistent support, worse
accuracy, bypasses server masking and the Pro gate, and violates the canonical spec ("STT MUST feed
the transcribed text into the chat system").
**Rationale**: near-zero blast radius on the proven extraction/draft/gate/SSE path; STT/TTS isolated
behind Mock-testable ports. The accepted cost is two extra round-trips per voice turn (transcribe,
then chat) — revisited only if latency proves unacceptable.

### Decision: `whisper-1` for STT (not `gpt-4o-transcribe`)
**Choice**: Pin the STT model to `whisper-1` via `POST /v1/audio/transcriptions`, EN/ES via the
optional `language` hint derived from the request locale (never required — Whisper autodetects).
**Alternatives**: `gpt-4o-transcribe` / `gpt-4o-mini-transcribe` — **rejected for v1**: newer and
higher-quality but they do NOT support `response_format: verbose_json`/`json` uniformly, are more
expensive, and their streaming transcription surface is unnecessary for a single push-to-talk blob.
`whisper-1` is the stable, cheapest ($0.006/min), best-documented file→text endpoint and is
sufficient for short create-plan utterances.
**Rationale**: the model is pinned in ONE place (the OpenAI-audio adapter constant), so a later
swap to `gpt-4o-transcribe` is a one-line adapter change behind the unchanged `SpeechTranscriber`
port — the route, UI, and tests never see the model name.

### Decision: Audio caps — 15 MB / 120 s / allow-list of container formats
**Choice**: Enforce, both client-side (pre-upload guard) and server-side (the real enforcement):
- **Max size 15 MB** (well under OpenAI's ~25 MB and Fastify's default 1 MB body limit — the
  transcribe route raises `bodyLimit` to 15 MB for its multipart scope ONLY).
- **Max duration ~120 s** (a create-plan utterance is short; duration is a soft cap — the hard gate
  is byte size, since server-side duration requires decoding).
- **Accepted content types**: `audio/webm` (Chrome/Firefox opus), `audio/mp4` + `audio/x-m4a`
  (Safari / iOS PWA), `audio/m4a` (Expo RN), `audio/mpeg`, `audio/wav`. A content type outside the
  allow-list → `415 { error: "unsupported_audio_format" }` BEFORE any OpenAI call.
**Rationale**: caps bound the un-metered marginal cost (the Pro gate is the primary control; caps
are the secondary abuse guard the proposal calls for) and prevent oversized/adversarial uploads
from reaching OpenAI. Enforced server-side because a client cap is advisory only.

### Decision: Graceful "could not understand" result, never a 5xx
**Choice**: The transcribe route returns `200 { text: "" , unclear: true }` when Whisper yields an
empty/whitespace transcript (silence/noise), and maps an OpenAI transport failure to
`502 { error: "transcription_failed" }` handled by the client as a re-prompt — never an unhandled
crash. The client treats `unclear: true` or empty `text` as "I didn't catch that, try again" and
does NOT start a chat turn.
**Rationale**: matches item-12's fail-soft posture (a bad turn never corrupts state); silence is a
normal user event, not an error.

### Decision: Dedicated `OPENAI_API_KEY` for STT/TTS, decoupled from `ai_provider_config`
**Choice**: The OpenAI-audio adapters read `process.env["OPENAI_API_KEY"]` at call time (never at
construction — matching every existing adapter, `adapter-factory.ts:65`), independent of the
dynamically-resolved chat provider/model. Voice is documented as OpenAI-only.
**Alternatives**: route STT/TTS through the dynamic `ai_provider_config` / `DynamicConfigRepo` used
by extraction (`extraction-adapter.ts:149`) — **rejected**: that config resolves to
openrouter/anthropic/google/opencode-go, none of which expose Whisper/TTS; forcing audio through it
would break the multi-provider abstraction (a "provider" that only sometimes supports audio).
**Rationale**: Whisper/TTS ARE OpenAI-specific; a separate key keeps the chat provider free to be
any provider while voice stays pinned to OpenAI. Note: the existing `OPENAI_API_KEY` is already read
by `createOpenAIAdapter` when the chat provider happens to be `openai` — voice reuses the SAME env
var, which is correct (one OpenAI account) and does not couple the two code paths.

### Decision: `openai` SDK (not raw `fetch`) in `apps/api` only
**Choice**: Add the `openai` npm package to `apps/api/package.json`. The audio adapters call
`client.audio.transcriptions.create(...)` and `client.audio.speech.create(...)`.
**Alternatives**: hand-rolled `fetch` to `/v1/audio/*` — **rejected**: multipart assembly, retry,
and error taxonomy would be re-implemented and drift from OpenAI's contract; the SDK is the
supported surface.
**Rationale**: `deps-guard.mjs` bans `openai` OUTSIDE `apps/api` (`AI_PATTERNS`/
`AI_ALLOWED_WORKSPACES`, lines 62-71); adding it to `apps/api` is deps-guard-clean. Web and mobile
NEVER import it — they only ship audio bytes and play audio. A deps-guard run is part of A1's DoD.

### Decision: TTS = `gpt-4o-mini-tts`, voice `alloy`, `mp3` output, play-after-turn
**Choice**: `POST /v1/audio/speech` with `model: "gpt-4o-mini-tts"`, `voice: "alloy"`,
`response_format: "mp3"`, `input` = the terminal `assistantMessage` (bounded to OpenAI's ~4096-char
cap; longer replies are truncated at a sentence boundary server-side). v1 speaks AFTER the turn
completes — TTS the single terminal `assistantMessage`, not incremental token frames.
**Alternatives**: `tts-1`/`tts-1-hd` — acceptable but `gpt-4o-mini-tts` is cheaper and newer with
comparable quality; sentence-chunked incremental TTS — **rejected for v1** (net-new `MediaSource`
streaming complexity; the chat prose streams token-by-token but TTS needs coherent text). `mp3`
over `opus`/`aac` — `mp3` has the broadest `<audio>` + Expo playback support.
**Rationale**: model/voice/format are pinned in ONE adapter constant behind the `SpeechSynthesizer`
port; playback is dead-simple (full blob → object URL → `<audio>` / Expo sound).

### Decision: TTS opt-out stored as a nullable `tts_enabled` column on `user_preferences`
**Choice**: Add `tts_enabled boolean` (nullable) to the existing `user_preferences` table
(`schema.ts:917`), reusing the 10a/10b preferences surface end-to-end (`UserPreferencesRepository`,
`GET/PUT /user-preferences`, `preferences-client.ts`, `UserPreferences` contract). Semantics:
`NULL` or `true` → TTS enabled (opt-out default is ON, per spec "TTS is SHOULD, opt-out via
settings"); `false` → user has opted out. The `/plan-specs/speech` route resolves the flag from the
authenticated user's preferences and returns `204 No Content` when opted out (the client then simply
does not play).
**Alternatives**: a brand-new `voice_preferences` table — **rejected**: over-engineered for one
boolean; `user_preferences` is already the per-user settings home with partial-merge upsert
semantics (`user-preferences.ts:76`) that additively absorb a new nullable column with ZERO
migration risk to existing rows. Storing it client-side (localStorage) — **rejected**: must be
server-authoritative so `/plan-specs/speech` can honor it and it persists cross-device.
**Rationale**: minimal additive migration (one nullable column, NULL-safe default), reuses the
proven partial-merge upsert (absent key preserves stored value), and extends the existing
`UserPreferences` DTO by one optional field — web and mobile read it through the SAME client.

### Decision: Web voice is an affordance INSIDE `AssistantPane`, not a third mode
**Choice**: Mic capture, the OD-inspired orb/listening states, and `<audio>` playback are added as a
voice sub-mode WITHIN the existing Asistente pane (`AssistantPane.tsx`), reusing its `runTurn`
transport (`AssistantPane.tsx:117`). A voice utterance calls transcribe, then feeds the returned
text into `runTurn(text, true)` — the exact same SSE path a typed message uses. The
`CreatePlanShell` Asistente/Formulario toggle (`CreatePlanShell.tsx:91`) is unchanged.
**Alternatives**: a separate third mode/route — **rejected**: duplicates the pane's turn
serialization + abort wiring and fragments the Asistente UX (exploration open-question 8 recommends
an affordance inside Asistente).
**Rationale**: voice reuses `runTurn` and the same-origin `/create-plan/chat` proxy (`chat/route.ts`)
verbatim; the ONLY new web transport is a same-origin proxy for the audio uploads (below).

### Decision: Web audio uploads via same-origin proxy routes (mirror `chat/route.ts`)
**Choice**: Add same-origin proxies `POST /create-plan/transcribe` and `POST /create-plan/speech`
that read the `kinora_session` httpOnly cookie server-side and forward the audio (multipart) /
text as a Bearer to the API — mirroring the existing `chat/route.ts` proxy (`chat/route.ts:32`).
The browser MediaRecorder blob is posted same-origin; the proxy streams it upstream with
`duplex: "half"`.
**Rationale**: the browser cannot attach the httpOnly session cookie as a Bearer cross-origin — the
SAME constraint that forced the chat proxy. Reusing that pattern keeps the token server-side and
web free of any API-origin/CORS coupling.

### Decision: RN SSE reader via `react-native-sse`-style XHR chunked reading — NOT `fetch`/`EventSource`
**Choice**: The RN create-plan chat (Track C) reads the `/plan-specs/chat` `text/event-stream` body
using an **XHR-progress chunked reader** (the mechanism `react-native-sse` implements): a POST XHR
with `responseType: "text"`, reading `xhr.responseText` deltas on each `readystatechange`/`progress`
event and parsing frames with the SAME pure `parseSSEStream`/`parseFrame` logic ported from
`chat-stream.ts:15`. The token is attached directly as an `Authorization: Bearer` header from
`expo-secure-store` (`session-storage.ts:13`) — mobile calls the API DIRECTLY, so there is NO
same-origin proxy (unlike web).
**Alternatives evaluated**:
- **`fetch` + `ReadableStream`** (what web uses, `AssistantPane.tsx:150`) — **rejected**: React
  Native's `fetch` (whatwg-fetch polyfill over XHR) does NOT expose `response.body` as a readable
  stream; `res.body` is `null` in RN, so the web streaming reader cannot be reused directly.
- **`EventSource` / a native EventSource lib** — **rejected**: EventSource cannot POST and cannot
  set an `Authorization` header (the exact reasons item 12 rejected it for web, design.md:154), and
  our turn is a POST with a Bearer.
- **`expo/fetch` streaming** — noted as a forward option (Expo's newer streaming fetch does surface
  a body reader) but **not pinned for v1**: it is newer/less battle-tested on the pinned
  `expo ~53` / `react-native 0.79.5`, and the XHR approach works today across both platforms.
- **`react-native-sse` library** — the reference implementation for the chosen approach; we may
  depend on it directly OR inline a ~40-line XHR reader (decided at C2 implementation; the library
  is a small, RN-only transport dep, deps-guard-clean since it is not an AI/DB/PWA/Capacitor
  pattern). The parser stays OURS (ported `parseFrame`).
**Rationale**: XHR chunked reading is the one SSE mechanism that (a) supports POST + Bearer, (b)
works on the pinned Expo/RN versions, and (c) lets us reuse the pure frame parser unchanged so RN
and web share turn semantics. This is the single riskiest RN decision and is called out as such.

### Decision: Track C is the dominant effort — foundation-first, multi-slice
**Choice**: `apps/mobile` has NO create-plan/chat today (grep `create-plan|PlanSpec` in
`apps/mobile` = 0 hits; only tracker/history/home/login/signup exist). Mobile voice (D) CANNOT be
built until C ports the item-12 chat to RN: (C1) an RN plan-draft client mirroring
`plan-draft-client.ts` with `expo-secure-store` Bearer auth (mirroring `workout-session.ts:34`),
(C2) the RN SSE reader + Asistente/extraction UI to parity with web. C2 is expected to exceed
~200 authored lines and MUST split (C2a SSE transport + turn lifecycle, C2b Asistente/extraction UI
+ i18n). Track C, not the voice tracks, is the bulk of change 13.
**Rationale**: honest sequencing — the OD "Asistente de voz" is a MOBILE screen but item 12 shipped
web-only, so mobile voice's true prerequisite is an entire RN chat surface. Under-scoping C would
silently balloon a "voice" slice into a chat-foundation slice.

## Data Flow

### Sequence — one web voice turn (mic → transcribe → existing chat → optional speech)

    User (push-to-talk)
      │ getUserMedia({audio:true}) → MediaRecorder(webm/opus | mp4 Safari)
      │ release → one Blob
      ▼
    AssistantPane (voice sub-mode)
      │ POST /create-plan/transcribe  (multipart, same-origin)
      ▼
    Web proxy /create-plan/transcribe   [reads kinora_session cookie → Bearer]
      │ POST {API}/plan-specs/transcribe  (Bearer, multipart, duplex:half)
      ▼
    API /plan-specs/transcribe
      │ requireAuth → authContext (tenant/user; NEVER body)
      │ ChatEntitlementPort.check → pro?  ──no──▶ 403 premium_required   [BEFORE any OpenAI call]
      │ validate content-type ∈ allow-list ──no──▶ 415
      │ validate size ≤ 15MB ──no──▶ 413
      │ SpeechTranscriber.transcribe(bytes, signal)  [whisper-1, in-flight only, NEVER persisted]
      │ empty transcript → 200 { text:"", unclear:true }   |  transport fail → 502
      └ 200 { text }
      ▼
    AssistantPane: if unclear/empty → re-prompt (no chat turn)
      │ else → runTurn(text, true)  ── EXISTING path, byte-identical to typed ──▶
      ▼
    API /plan-specs/chat  (unchanged: hijack → Pass1 token frames → Pass2 extract →
      mergePlanSpecDraft → commit-if-changed → terminal draft{draftSpec,missingFields,assistantMessage})
      ▼
    AssistantPane: terminal draft → onSpecChange(draftSpec); assistantMessage rendered
      │ if ttsEnabled:  POST /create-plan/speech { text: assistantMessage }
      ▼
    Web proxy → API /plan-specs/speech
      │ requireAuth → Pro gate → resolve user tts_enabled
      │ opted out → 204 (client plays nothing)
      │ else SpeechSynthesizer.synthesize(text) [gpt-4o-mini-tts, mp3] ──▶ audio bytes
      ▼
    AssistantPane: Blob → URL.createObjectURL → <audio>.play()  [gesture-anchored: the mic press]

Raw audio exists ONLY in flight (browser Blob + the transcribe request body); it is NEVER written to
any store. The transcript enters state ONLY through the existing masked `/plan-specs/chat` path.

### Sequence — one mobile voice turn (Track D on the Track C foundation)

    User (hold mic on "Asistente de voz" screen: Listo→Escuchando)
      │ expo-audio Recording → .m4a file URI  (Procesando)
      ▼
    RN VoiceScreen
      │ POST {API}/plan-specs/transcribe  (Bearer from expo-secure-store, multipart m4a) ── DIRECT, no proxy
      ▼
    API /plan-specs/transcribe   [same gate/caps/no-persistence as web]  → { text }
      ▼
    RN chat store (Track C): openChatTurn(text)
      │ XHR POST {API}/plan-specs/chat (Bearer)  → onProgress → parseFrame → token/draft/error
      ▼
    RN Asistente UI: streams prose (kInorA responde), terminal draft → extraction panel
      │ if ttsEnabled: POST {API}/plan-specs/speech {text} → mp3 bytes → expo-audio playback
      ▼
    mic-denied at any point → text-input fallback (RN chat still fully works typed)

## File Changes

| File | Action | Track/Slice | Description |
|------|--------|-------------|-------------|
| `apps/api/package.json` | Modify | A1 | add `openai` SDK (deps-guard-clean; apps/api only) |
| `apps/api/src/ai/speech-transcriber-port.ts` | Create | A1 | `SpeechTranscriber` port (mirrors `PlanSpecExtractor`) |
| `apps/api/src/ai/openai-audio-adapter.ts` | Create | A1 | OpenAI-audio adapter (`whisper-1`); reads dedicated `OPENAI_API_KEY` at call time |
| `apps/api/src/ai/mock-speech-transcriber.ts` | Create | A1 | deterministic Mock (no network) |
| `apps/api/src/routes/plan.ts` | Modify | A2 | `POST /plan-specs/transcribe` (multipart, Pro-gated, tenant-scoped, caps, no persistence, unclear-result) |
| `apps/api/src/ai/speech-synthesizer-port.ts` | Create | A3 | `SpeechSynthesizer` port |
| `apps/api/src/ai/openai-audio-adapter.ts` | Modify | A3 | add TTS (`gpt-4o-mini-tts`, `alloy`, `mp3`) |
| `apps/api/src/ai/mock-speech-synthesizer.ts` | Create | A3 | deterministic TTS Mock |
| `apps/api/src/routes/plan.ts` | Modify | A3 | `POST /plan-specs/speech` (Pro gate + tts_enabled resolve; 204 on opt-out) |
| `apps/api/src/db/schema.ts` | Modify | A3 | `tts_enabled boolean` (nullable) on `user_preferences` |
| `apps/api/migrations/*` | Create | A3 | additive `ADD COLUMN tts_enabled boolean` migration |
| `apps/api/src/db/repositories/user-preferences.ts` | Modify | A3 | carry `ttsEnabled` through record + partial upsert |
| `apps/api/src/routes/user-preferences.ts` | Modify | A3 | read/write `ttsEnabled` in GET/PUT |
| `packages/contracts/src/index.ts` | Modify | A3 | `UserPreferences.ttsEnabled?: boolean \| null` |
| `apps/api/src/app.ts` | Modify | A2/A3 | wire transcriber + synthesizer adapters + gate into `planRoutes` |
| `apps/web/.../create-plan/transcribe/route.ts` | Create | B1 | same-origin multipart proxy (mirrors `chat/route.ts`) |
| `apps/web/.../create-plan/voice-client.ts` | Create | B1 | pure MediaRecorder capture + format select + transcribe call (unit-testable) |
| `apps/web/.../create-plan/AssistantPane.tsx` | Modify | B1 | mic capture, OD orb/listening states, transcribe→`runTurn`, mic-denied fallback |
| `apps/web/.../create-plan/speech/route.ts` | Create | B2 | same-origin TTS proxy |
| `apps/web/.../create-plan/AssistantPane.tsx` | Modify | B2 | `<audio>` gesture-anchored playback, opt-out honored |
| `packages/i18n/src/messages/{en,es}.json` | Modify | B2 | new `voice` namespace (EN/ES parity) |
| `apps/mobile/src/api/plan-draft-client.ts` | Create | C1 | RN draft/promote/confirm client (Bearer via `expo-secure-store`) |
| `apps/mobile/src/screens/create-plan/chat-stream.ts` | Create | C2a | ported pure `parseFrame` + RN XHR chunked SSE reader |
| `apps/mobile/src/screens/create-plan/chat-store.ts` | Create | C2a | RN turn lifecycle (abort, serialization) |
| `apps/mobile/src/screens/create-plan/AssistantScreen.tsx` | Create | C2b | RN Asistente chat + "Datos extraídos" UI (parity with web) |
| `apps/mobile/src/screens/create-plan/*.styles.ts` + navigation | Create/Modify | C2b | screen styles + react-navigation entry |
| `apps/mobile/package.json` | Modify | C2a | `react-native-sse` (or inline XHR reader — decided at impl) |
| `apps/mobile/src/screens/voice/VoiceScreen.tsx` | Create | D1 | OD "Asistente de voz" (orb, Listo→Escuchando→Procesando→responde, transcript, push-to-talk) |
| `apps/mobile/src/audio/recorder.ts` | Create | D1 | `expo-audio` mic capture + permission + graceful denial |
| `apps/mobile/package.json` | Modify | D1 | `expo-audio` |
| `apps/mobile/src/audio/player.ts` | Create | D2 | `expo-audio` mp3 playback of the reply |
| `packages/i18n/src/messages/{en,es}.json` | Modify | D2 | mobile voice strings (share `voice` namespace) |

## Interfaces / Contracts

```typescript
// apps/api/src/ai/speech-transcriber-port.ts — mirrors PlanSpecExtractor; no import beyond node/Buffer.
export interface TranscribeInput {
  audio: Uint8Array;          // in-flight bytes ONLY — never persisted
  contentType: string;        // validated against the allow-list at the route
  language?: string;          // optional EN/ES hint from request locale
}
export interface TranscribeResult {
  text: string;               // "" when unintelligible
  unclear: boolean;           // true on silence/noise/empty
}
export interface SpeechTranscriber {
  transcribe(input: TranscribeInput, signal?: AbortSignal): Promise<TranscribeResult>;
}

// apps/api/src/ai/speech-synthesizer-port.ts
export interface SynthesizeResult { audio: Uint8Array; contentType: "audio/mpeg"; }
export interface SpeechSynthesizer {
  synthesize(text: string, signal?: AbortSignal): Promise<SynthesizeResult>;
}

// packages/contracts — additive, backward-compatible
export interface UserPreferences {
  userId: string;
  defaultLocation: string | null;
  defaultDuration: number | null;
  defaultEquipment: string[] | null;
  ttsEnabled?: boolean | null;   // NULL/true = enabled (opt-out default ON); false = opted out
}
```

Route contracts (all: `requireAuth` → `ChatEntitlementPort.check` fail-closed BEFORE any OpenAI
call; tenant/user from `authContext`; consume NO billing quota):

- `POST /plan-specs/transcribe` — multipart audio in → `200 { text, unclear }` |
  `403 { error: reason }` (Free) | `413` (too large) | `415 unsupported_audio_format` |
  `502 transcription_failed`. Registered only when the transcriber + gate are wired (mirrors the
  chat-route registration guard, `plan.ts:552`).
- `POST /plan-specs/speech` — `{ text }` in → `200` audio/mpeg body | `204` (user opted out) |
  `403` (Free) | `502 synthesis_failed`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (ai) | `MockSpeechTranscriber`/`MockSpeechSynthesizer` determinism; adapter pins `whisper-1`/`gpt-4o-mini-tts`; key read at call time | Mock + injected OpenAI client fake, no network |
| API (transcribe) | Free→403 BEFORE any transcribe; Pro→200; oversize→413; bad type→415; silence→`{unclear:true}`; transport fail→502; audio NEVER persisted (spy on repos → zero writes); tenant from authContext | `buildTestApp` + Mock transcriber + fake entitlement reader |
| API (speech) | Pro gate; `ttsEnabled=false`→204; `null`/`true`→audio; no persistence | `buildTestApp` + Mock synthesizer |
| API (prefs) | `ttsEnabled` partial-merge upsert (absent key preserves value); GET returns it; migration additive | repo + route tests (extend `user-preferences.test.ts`) |
| Web (voice) | mic-denied→text fallback; format select webm vs mp4; transcribe→`runTurn` feeds existing path; `<audio>` plays only when enabled + gesture-anchored; unclear→re-prompt | component tests, mocked `getUserMedia`/`MediaRecorder`/`HTMLMediaElement` |
| Web (proxy) | transcribe/speech proxy injects Bearer from cookie; forwards multipart; passes through 403/415 | route tests, mocked upstream fetch |
| RN (C) | plan-draft client Bearer + result mapping (mock fetch); ported `parseFrame` frame-split parity; XHR SSE reader emits token/draft/error; turn abort/serialization | vitest + mock XHR/fetch (mirrors `workout-session.test.ts`) |
| RN (D) | recorder permission grant/deny→fallback; transcribe→chat; mp3 playback; orb state machine Listo→Escuchando→Procesando→responde | RN test-renderer + mocked `expo-audio` |
| E2E | (later) full spoke→draft→confirm on web | deferred |

## Threat Matrix

A new authenticated route family with process/LLM integration, audio (health + voice-biometric)
data, and a premium gate — applicable.

| Row | Applicable | Safe/failure behavior | RED test |
|-----|-----------|-----------------------|----------|
| Free bypass via client mode | Yes | endpoint gate denies 403 regardless of client | Free token → 403 on transcribe + speech |
| Tier/tenant spoof via body | Yes | tenant/tier from `authContext`/`resolveEffectiveTier` only | body tenantId ignored |
| Raw-audio persistence | Yes (N/A write) | audio in-flight only; NEVER written to any store | repo spies assert zero writes on transcribe |
| Health/limitation leak to LLM/observability | Yes | transcript flows through existing `/plan-specs/chat` which masks; transcribe/speech metadata = safe fields only, no audio bytes logged | masked-prompt assertion inherited; no-audio-in-logs assertion |
| Raw-transcript embedding | Yes (N/A write) | transcripts NEVER embedded (inherited from 12) | no vector-write on voice turn |
| Dedicated key leak | Yes | `OPENAI_API_KEY` never logged; adapter reads at call time; deps-guard confines `openai` to apps/api | deps-guard clean; log-scrub assertion |
| Audio size/format abuse | Yes | server caps 15MB/allow-list BEFORE OpenAI call | oversize→413, bad type→415 |
| Gate bypass before OpenAI cost | Yes | Pro check precedes ANY transcribe/synthesize call | Free never reaches the Mock (call-count 0) |
| Autoplay/gesture abuse (web) | Yes | first `.play()` anchored to the mic-press gesture | playback only after user gesture |

## Migration / Rollout

Additive. The ONLY schema change is `ADD COLUMN tts_enabled boolean` (nullable, no backfill — NULL =
enabled) on `user_preferences`; existing rows are untouched and the partial-merge upsert absorbs it
with zero risk. No change to any existing endpoint or the confirm→generate path. Rollback per track:

- **D** (mobile voice): remove the Expo voice screen + recorder/player; the RN chat foundation (C)
  still works as text.
- **C** (mobile foundation): remove the RN create-plan chat; existing mobile tracker/history/home
  flows never depended on it.
- **B** (web voice): remove mic capture + orb + `<audio>` + the two web proxies + `voice` i18n from
  `AssistantPane`; the item-12 text Asistente is unaffected.
- **A** (shared API): remove `/plan-specs/transcribe` + `/plan-specs/speech` + the audio ports; drop
  `openai`; the `tts_enabled` column is inert if unused and can be dropped in a follow-up migration.

The item-12 chat, drafts, and generation keep functioning at every rollback point. If A2 or C2
exceeds ~200 authored lines, split as noted (A2a transport+gate+caps / A2b transcriber wiring;
C2a SSE transport+turn lifecycle / C2b Asistente/extraction UI+i18n).

## Open Questions

- [ ] Confirm the multipart parser in `apps/api` (register `@fastify/multipart` scoped to the
      transcribe route, or accept a raw octet-stream body). Lean: `@fastify/multipart` with a
      15 MB `bodyLimit` on the route only.
- [ ] Pin whether Track C depends on the `react-native-sse` package or inlines a ~40-line XHR
      reader — decide at C2a from the size budget (parser stays ours regardless).
- [ ] `expo-audio` vs `expo-av`: recommend the newer `expo-audio` (the `expo-av` Audio API is
      deprecated on `expo ~53`); confirm it is available on the pinned SDK at D1.
- [ ] Truncation strategy for TTS `input` > ~4096 chars (sentence-boundary cut server-side) —
      create-plan replies are short, so this is a guard, not a common path.
</content>
</invoke>
