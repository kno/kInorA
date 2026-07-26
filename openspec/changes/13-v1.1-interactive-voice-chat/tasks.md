# Tasks: 13 — Interactive Voice Chat (v1.1 voice companion to create-plan)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1650–1900 across 10 slices (~120–200 each) |
| 400-line budget risk | Low (per-slice); Track C (C1+C2a+C2b) and Track D (D1+D2) each exceed 400 in aggregate |
| Chained PRs recommended | Yes — 10 chained PRs across 4 tracks |
| Suggested split | PR1 A1 STT port/adapter/Mock → PR2 A2 transcribe route → PR3 A3 speech route+TTS pref → PR4 B1 web mic+transcribe→chat → PR5 B2 web TTS+i18n → PR6 C1 RN draft client → PR7 C2a RN SSE reader → PR8 C2b RN Asistente UI → PR9 D1 Expo mic+voice screen → PR10 D2 native TTS+parity |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — ask the user (stacked-to-main vs feature-branch-chain); A and C may proceed in parallel branches, B branches off A, D branches off A+C |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Low per-slice; Track C and Track D are the aggregate risk (foundation-first, called out in design as the dominant effort)

The transcribe (A2) and speech (A3) routes sit on the auth + Pro-gate + external-API hot path
(OpenAI, un-metered) → treat as high-risk (full 4R) at review time regardless of per-slice line
count, matching item-12's S2/S2b precedent. C2a (RN SSE transport) is called out in design as
"the single riskiest RN decision" — treat as high-risk at review time as well.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| A1 | `SpeechTranscriber` port + OpenAI-audio adapter (`whisper-1`) + Mock. No route, no UI, no billing change | PR1 | `pnpm --filter api test -- src/ai/__tests__/mock-speech-transcriber.test.ts src/ai/__tests__/openai-audio-adapter.test.ts` | N/A — Mock/injected-client unit tests, no network | `apps/api/src/ai/{speech-transcriber-port,openai-audio-adapter,mock-speech-transcriber}.ts` — unused if A2 reverts |
| A2 | `POST /plan-specs/transcribe`: Pro gate fail-closed, multipart caps/allow-list, no persistence, unclear-result taxonomy | PR2 | `pnpm --filter api test -- src/routes/__tests__/plan-transcribe.test.ts` | `pnpm --filter api dev` + curl multipart smoke (Free 403, Pro 200, oversize 413, bad type 415) | `apps/api/src/routes/plan.ts` (transcribe route scope) — drop route, chat/drafts unaffected |
| A3 | `POST /plan-specs/speech` (TTS) + `tts_enabled` migration + preferences plumbing | PR3 | `pnpm --filter api test -- src/ai/__tests__/mock-speech-synthesizer.test.ts src/routes/__tests__/plan-speech.test.ts src/db/repositories/__tests__/user-preferences.test.ts` | `pnpm --filter api dev` + curl smoke (opt-out→204, opt-in→audio/mpeg) | `apps/api/src/routes/plan.ts` (speech route scope), `apps/api/src/ai/{speech-synthesizer-port,mock-speech-synthesizer}.ts`, migration — column inert if unused |
| B1 | Web mic capture (push-to-talk) + transcribe → existing `runTurn` chat turn + mic-denied/offline fallback | PR4 | `pnpm --filter web test -- src/app/.../create-plan` | `pnpm --filter web dev` (mic prompt, mic-denied fallback, offline toggle) | `apps/web/.../create-plan/{voice-client.ts,transcribe/route.ts}`, `AssistantPane.tsx` (voice sub-mode) — Asistente text mode unaffected |
| B2 | Web `<audio>` TTS playback (gesture-anchored) + `voice` i18n namespace | PR5 | `pnpm --filter web test -- src/app/.../create-plan` + `pnpm --filter i18n test` | `pnpm --filter web dev` (TTS on/off, EN/ES toggle) | `apps/web/.../create-plan/speech/route.ts`, `AssistantPane.tsx` (playback), `packages/i18n/.../{en,es}.json` (`voice` namespace) |
| C1 | RN plan-draft client + `expo-secure-store` Bearer auth (no chat yet) | PR6 | `pnpm --filter mobile test -- src/api/__tests__/plan-draft-client.test.ts` | N/A — mocked-fetch unit tests | `apps/mobile/src/api/plan-draft-client.ts` — unused if C2 reverts |
| C2a | RN XHR-chunked SSE reader (ported pure `parseFrame`) + turn lifecycle store | PR7 | `pnpm --filter mobile test -- src/screens/create-plan/__tests__/chat-stream.test.ts src/screens/create-plan/__tests__/chat-store.test.ts` | N/A — mocked XHR unit tests | `apps/mobile/src/screens/create-plan/{chat-stream,chat-store}.ts` |
| C2b | RN Asistente + "Datos extraídos" extraction UI to web parity + i18n | PR8 | `pnpm --filter mobile test -- src/screens/create-plan/__tests__/AssistantScreen.test.tsx` + `pnpm --filter i18n test` | Expo dev client / simulator smoke (type-drive extraction end-to-end) | `apps/mobile/src/screens/create-plan/{AssistantScreen.tsx,*.styles.ts}` + navigation entry |
| D1 | Expo mic capture + OD "Asistente de voz" screen → transcribe → RN chat turn | PR9 | `pnpm --filter mobile test -- src/audio/__tests__/recorder.test.ts src/screens/voice/__tests__/VoiceScreen.test.tsx` | Device/simulator smoke (permission prompt, denial fallback, offline degrade) | `apps/mobile/src/audio/recorder.ts`, `apps/mobile/src/screens/voice/VoiceScreen.tsx` — RN chat foundation (C) still works as text |
| D2 | Native mp3 TTS playback + parity with web voice + billing-boundary assertion | PR10 | `pnpm --filter mobile test -- src/audio/__tests__/player.test.ts src/screens/voice/__tests__/VoiceScreen.test.tsx` | Device/simulator smoke matching web voice UX | `apps/mobile/src/audio/player.ts`, `VoiceScreen.tsx` (playback wiring) |

---

## Track A — Shared API (backend, reusable by web and mobile)

## Phase 1: Slice A1 — `SpeechTranscriber` Port + OpenAI-Audio Adapter + Mock [Requirements: Speech-to-Text Transcription Endpoint]

- [x] 1.1 RED: Add failing `apps/api/src/ai/__tests__/mock-speech-transcriber.test.ts` asserting `MockSpeechTranscriber.transcribe` returns a deterministic `{text, unclear}` result for a fixed input, and a fixed "silence" input marker returns `{text:"", unclear:true}` — no network.
- [x] 1.2 GREEN: Create `apps/api/src/ai/speech-transcriber-port.ts` (`SpeechTranscriber` interface, `TranscribeInput`/`TranscribeResult`, mirrors `PlanSpecExtractor`) and `apps/api/src/ai/mock-speech-transcriber.ts` implementing it deterministically.
- [x] 1.3 RED: Add failing `apps/api/src/ai/__tests__/openai-audio-adapter.test.ts` (transcribe half) asserting the adapter calls an injected OpenAI client's `audio.transcriptions.create` with `model: "whisper-1"`, forwards `contentType`/optional `language`, reads `OPENAI_API_KEY` at call time (not construction — matching `adapter-factory.ts:65`), maps an empty/whitespace transcript to `{text:"", unclear:true}`, and maps an injected client throw to a safe rejection (never an unhandled crash).
- [x] 1.4 GREEN: Create `apps/api/src/ai/openai-audio-adapter.ts` implementing `SpeechTranscriber` via the `openai` SDK, constructed with the client injectable for tests.
- [x] 1.5 GREEN: Add the `openai` npm package to `apps/api/package.json` only.
- [x] 1.6 TRIANGLE: Run `pnpm --filter api test -- src/ai/__tests__/mock-speech-transcriber.test.ts src/ai/__tests__/openai-audio-adapter.test.ts` green; `pnpm -w typecheck`; run `scripts/deps-guard.mjs` and confirm `openai` is confined to `apps/api`; confirm zero HTTP-route/web/mobile touch in this slice's diff.

## Phase 2: Slice A2 — `POST /plan-specs/transcribe` [Requirements: Speech-to-Text Transcription Endpoint, Audio Upload Validation and Caps, Voice Endpoint Pro Gate (Fail-Closed), Voice Billing Boundary]

- [x] 2.1 RED: Add failing `apps/api/src/routes/__tests__/plan-transcribe.test.ts` (Threat Matrix: Free bypass, tier/tenant spoof, gate-bypass-before-cost): Free tenant → `403 { error: "premium_required" }` with the injected transcriber's call count asserted `0`; Pro tenant with valid small multipart audio → `200 { text, unclear: false }`; body-injected `tenantId`/`tier="pro"` ignored (resolved only from `authContext`); expired-trial tenant → denied before any transcribe call.
- [x] 2.2 RED: Extend the same test file (Audio Upload Validation and Caps): oversize upload (>15 MB) → `413` before any transcribe call; unsupported content type (outside the allow-list) → `415 { error: "unsupported_audio_format" }` before any transcribe call; empty/zero-byte or missing audio part → validation error prompting re-record, no transcribe call.
- [x] 2.3 RED: Extend the same test file (fail-soft taxonomy): injected transcriber throwing a transport error → `502 { error: "transcription_failed" }`; injected transcriber returning `{text:"", unclear:true}` (silence/noise) → `200 { text:"", unclear:true }`, no crash, no draft write.
- [x] 2.4 RED: Add a repo/storage spy assertion (Threat Matrix: raw-audio persistence) — across the success, unclear, and every error path, zero writes occur to any repository, log sink, or vector store containing audio bytes.
- [x] 2.5 GREEN: Register `@fastify/multipart` scoped to the transcribe route only, with a `bodyLimit` of 15 MB; add `POST /plan-specs/transcribe` to `apps/api/src/routes/plan.ts` — `requireAuth` → `ChatEntitlementPort.check` fail-closed BEFORE any multipart/transcribe work → validate content-type against the allow-list (`audio/webm`, `audio/mp4`, `audio/x-m4a`, `audio/m4a`, `audio/mpeg`, `audio/wav`) → validate size ≤ 15 MB → call `SpeechTranscriber.transcribe(bytes, signal)` → map result/error taxonomy to the response.
- [x] 2.6 GREEN: Wire the real `openai-audio-adapter` (Mock retained for tests) + `ChatEntitlementPort` into `apps/api/src/app.ts` for this route, registration-guarded like the item-12 chat route.
- [x] 2.7 TRIANGLE: Run `pnpm --filter api test -- src/routes/__tests__/plan-transcribe.test.ts` green; `pnpm -w typecheck`; manual smoke via `pnpm --filter api dev` + curl (Free 403, Pro 200, oversize 413, bad content-type 415); confirm no route path reaches OpenAI before the Pro-gate check and no audio bytes appear in logs.

## Phase 3: Slice A3 — `POST /plan-specs/speech` + TTS Opt-Out Preference [Requirements: Text-to-Speech Speech Endpoint, TTS Opt-Out Preference, Voice Endpoint Pro Gate (Fail-Closed)]

- [x] 3.1 RED: Add failing `apps/api/src/ai/__tests__/mock-speech-synthesizer.test.ts` asserting `MockSpeechSynthesizer.synthesize` returns deterministic `{audio, contentType:"audio/mpeg"}` for a fixed text input — no network.
- [x] 3.2 GREEN: Create `apps/api/src/ai/speech-synthesizer-port.ts` (`SpeechSynthesizer`, `SynthesizeResult`) and `apps/api/src/ai/mock-speech-synthesizer.ts`.
- [x] 3.3 RED: Extend `apps/api/src/ai/__tests__/openai-audio-adapter.test.ts` (speech half): pins `model: "gpt-4o-mini-tts"`, `voice: "alloy"`, `response_format: "mp3"`; truncates `input` at a sentence boundary beyond the ~4096-char OpenAI cap before calling the client; reads `OPENAI_API_KEY` at call time.
- [x] 3.4 GREEN: Add the TTS method to `apps/api/src/ai/openai-audio-adapter.ts` implementing `SpeechSynthesizer`.
- [x] 3.5 RED: Add failing `packages/contracts/src/__tests__/user-preferences.test.ts` (extend or create) asserting `UserPreferences.ttsEnabled?: boolean | null` is additive/backward-compatible (omitting it still validates).
- [x] 3.6 GREEN: Add `ttsEnabled?: boolean | null` to the `UserPreferences` interface in `packages/contracts/src/index.ts`.
- [x] 3.7 RED: Extend `apps/api/src/db/repositories/__tests__/user-preferences.test.ts`: writing `ttsEnabled` via the partial-merge upsert preserves other stored fields; omitting `ttsEnabled` on a subsequent upsert preserves the previously stored value; `NULL`/absent reads as enabled (not opted out).
- [x] 3.8 GREEN: Add an additive migration `ADD COLUMN tts_enabled boolean` (nullable, no backfill) on `user_preferences`; update `apps/api/src/db/schema.ts`; carry `ttsEnabled` through `apps/api/src/db/repositories/user-preferences.ts` (partial upsert) and `apps/api/src/routes/user-preferences.ts` (GET/PUT).
- [x] 3.9 RED: Add failing `apps/api/src/routes/__tests__/plan-speech.test.ts`: Free tenant → `403` before any synthesize call; Pro tenant with `ttsEnabled` `null`/`true` → `200` `audio/mpeg` body, synthesizer called once, no persistence; Pro tenant with `ttsEnabled=false` → `204 No Content`, synthesizer call count `0`; over-length text input → rejected or truncated per the cap before any OpenAI call; injected synthesizer throw → `502 { error: "synthesis_failed" }`.
- [x] 3.10 GREEN: Add `POST /plan-specs/speech` to `apps/api/src/routes/plan.ts` — `requireAuth` → `ChatEntitlementPort.check` fail-closed → resolve the authenticated user's `ttsEnabled` preference → `204` if opted out → else `SpeechSynthesizer.synthesize(text, signal)` → `audio/mpeg` response; wire the adapter + gate into `apps/api/src/app.ts`.
- [x] 3.11 TRIANGLE: Run `pnpm --filter api test -- src/ai/__tests__/mock-speech-synthesizer.test.ts src/ai/__tests__/openai-audio-adapter.test.ts src/db/repositories/__tests__/user-preferences.test.ts src/routes/__tests__/plan-speech.test.ts` green; `pnpm -w typecheck`; `scripts/deps-guard.mjs` clean; manual smoke (opt-out→204, opt-in→audio bytes); confirm the migration is additive with zero risk to existing rows.

---

## Track B — Web Voice (depends on Track A)

## Phase 4: Slice B1 — Web Mic Capture + Transcribe → Existing Chat Turn [Requirements: Voice Reuses the Existing Chat Path Unchanged, Voice Interaction and Microphone Permission (Web and Mobile), Offline Voice Degradation]

- [x] 4.1 RED: Add failing `apps/web/src/app/(app)/create-plan/__tests__/voice-client.test.ts` — pure format-select logic (prefers `audio/webm;codecs=opus`, falls back to `audio/mp4` for Safari) with mocked `MediaRecorder.isTypeSupported`; the transcribe-call shape (multipart POST) against a mocked `fetch`.
- [x] 4.2 GREEN: Create `apps/web/src/app/(app)/create-plan/voice-client.ts` (pure capture/format-select/transcribe-call helpers, unit-testable, no `openai`/LLM import).
- [x] 4.3 RED: Add failing `apps/web/src/app/(app)/create-plan/transcribe/__tests__/route.test.ts` (mirrors `chat/route.ts` tests): no session cookie → `401`, no upstream call; Bearer forwarded from the `kinora_session` cookie; multipart body forwarded with `duplex: "half"`; upstream `403`/`413`/`415`/`502` passed through verbatim; unreachable upstream → safe error with no internal URL leaked.
- [x] 4.4 GREEN: Create `apps/web/src/app/(app)/create-plan/transcribe/route.ts` (same-origin multipart proxy mirroring `chat/route.ts`).
- [x] 4.5 RED: Extend `apps/web/.../create-plan/__tests__/AssistantPane.test.tsx`: mic permission denied → "microphone access required" message + text input remains usable, no crash; push-to-talk shows a listening state during capture and a processing state during transcription; a successful transcript feeds the existing `runTurn(text, true)` path unchanged; `unclear`/empty transcript → re-prompt copy shown, no chat turn started; offline (mocked `navigator.onLine`/`online`/`offline` events) → voice affordance disabled/degraded, text input still usable, no crash; connectivity restored → voice affordance re-enabled without a reload.
- [x] 4.6 GREEN: Modify `AssistantPane.tsx` — add a voice sub-mode (mic button/orb + listening/processing states) reusing `runTurn`; wire `voice-client.ts` capture → `transcribe/route.ts` → on `unclear`/empty re-prompt, else `runTurn(text, true)`; add mic-denied fallback and online/offline listeners toggling the voice affordance.
- [x] 4.7 TRIANGLE: Run `pnpm --filter web test -- src/app/.../create-plan` green (voice-client, transcribe route, AssistantPane); `pnpm -w typecheck`; `scripts/deps-guard.mjs` clean (no `openai`/LLM import in `apps/web`); manual smoke on `pnpm --filter web dev` (mic permission prompt, mic-denied fallback, offline toggle, transcript feeds the same Asistente turn as typed text).

## Phase 5: Slice B2 — Web TTS Playback + Voice i18n [Requirements: TTS Opt-Out Preference, Voice Interaction and Microphone Permission (Web and Mobile), Mobile Create-Plan Voice Parity]

- [ ] 5.1 RED: Add failing `apps/web/src/app/(app)/create-plan/speech/__tests__/route.test.ts` — Bearer forwarding, text body forwarded, upstream `204` (opted out) / `403` / `502` passed through verbatim.
- [ ] 5.2 GREEN: Create `apps/web/src/app/(app)/create-plan/speech/route.ts` (same-origin TTS proxy mirroring `chat/route.ts`).
- [ ] 5.3 RED: Extend `AssistantPane.test.tsx`: after the terminal `assistantMessage` with TTS enabled → calls `speech/route.ts`, plays via `<audio>` only after the prior user gesture (mic-press anchored `.play()`); a `204` (opted out) response → no playback attempt, no crash.
- [ ] 5.4 GREEN: Modify `AssistantPane.tsx` — add gesture-anchored `<audio>` playback: `Blob` → `URL.createObjectURL` → `.play()` on the terminal `assistantMessage` when TTS is enabled; skip cleanly on `204`.
- [ ] 5.5 RED: Add a failing i18n parity test (extend `packages/i18n`'s existing parity check or add one) asserting the new `voice` namespace has identical EN/ES key sets (mic-permission copy, listening/processing/speaking states, mic-denied fallback, offline-degraded copy).
- [ ] 5.6 GREEN: Add the `voice` namespace to `packages/i18n/src/messages/{en,es}.json` with EN/ES parity; wire the strings into the `AssistantPane` voice UI from B1/B2.
- [ ] 5.7 TRIANGLE: Run `pnpm --filter web test -- src/app/.../create-plan` + `pnpm --filter i18n test` green; `scripts/deps-guard.mjs` clean; `pnpm --filter web build`; manual smoke (TTS on/off, gesture-anchored playback, EN/ES toggle).

---

## Track C — Mobile Create-Plan Chat Foundation (prerequisite, large — may proceed in parallel with Track A)

## Phase 6: Slice C1 — RN Plan-Draft Client + Auth Wiring [Requirements: Mobile Create-Plan Voice Parity]

- [x] 6.1 RED: Add failing `apps/mobile/src/api/__tests__/plan-draft-client.test.ts` (mocked `fetch`): draft/promote/confirm calls attach a `Bearer` token read from `expo-secure-store`; success responses map to the expected result shape; error responses map to typed errors; no `openai`/LLM import.
- [x] 6.2 GREEN: Create `apps/mobile/src/api/plan-draft-client.ts` (mirrors the web `plan-draft-client.ts`), reading the session token via `expo-secure-store` (mirroring `session-storage.ts`/`workout-session.ts` patterns).
- [x] 6.3 RED: Extend the test file: a `401`/expired-session response triggers a re-auth/logout signal without crashing; tenant scoping derives only from the resolved auth context, never from a caller-supplied tenant id.
- [x] 6.4 GREEN: Wire session-storage read/expiry handling into `plan-draft-client.ts`.
- [x] 6.5 TRIANGLE: Run `pnpm --filter mobile test -- src/api/__tests__/plan-draft-client.test.ts` green; `pnpm -w typecheck`; `scripts/deps-guard.mjs` clean (no `openai` in `apps/mobile`).

## Phase 7: Slice C2a — RN XHR-Chunked SSE Reader + Turn Lifecycle [Requirements: Mobile Create-Plan Voice Parity]

- [ ] 7.1 RED: Add failing `apps/mobile/src/screens/create-plan/__tests__/chat-stream.test.ts` — the ported pure `parseFrame`/`parseSSEStream` logic produces byte-identical `token`/`draft`/`error` events to the web `chat-stream.ts` fixtures (reuse/port the same test fixtures), including invalid-JSON frame handling, unknown event names, and no-trailing-blank-line flush.
- [ ] 7.2 GREEN: Create `apps/mobile/src/screens/create-plan/chat-stream.ts` — port the pure frame-parsing logic unchanged from the web module.
- [ ] 7.3 RED: Extend `chat-stream.test.ts` with a mocked `XMLHttpRequest`: the XHR-chunked reader POSTs with an `Authorization: Bearer` header (never `EventSource`), reads `xhr.responseText` deltas on `readystatechange`/`progress`, and emits `token`/`draft`/`error` events via the ported parser as new bytes arrive.
- [ ] 7.4 GREEN: Implement the XHR-chunked SSE reader in `chat-stream.ts` (inline or via `react-native-sse`, sized decision per design; add the dependency to `apps/mobile/package.json` only if used).
- [ ] 7.5 RED: Add failing `apps/mobile/src/screens/create-plan/__tests__/chat-store.test.ts` — sending a turn streams tokens then commits state exactly once on the terminal `draft` event; unmount/navigation aborts the in-flight turn; a second turn cannot start while one is in flight (serialized, no overlapping-turn corruption).
- [ ] 7.6 GREEN: Create `apps/mobile/src/screens/create-plan/chat-store.ts` (turn lifecycle: `AbortController`, serialization guard, state updates driven by `chat-stream.ts` events).
- [ ] 7.7 TRIANGLE: Run `pnpm --filter mobile test -- src/screens/create-plan/__tests__/chat-stream.test.ts src/screens/create-plan/__tests__/chat-store.test.ts` green; `pnpm -w typecheck`; `scripts/deps-guard.mjs` clean; confirm the ported parser's event shapes match the web fixtures byte-for-byte (this is the riskiest RN decision — treat as high-risk at review time).

## Phase 8: Slice C2b — RN Asistente + Extraction UI to Web Parity [Requirements: Mobile Create-Plan Voice Parity]

- [ ] 8.1 RED: Add failing `apps/mobile/src/screens/create-plan/__tests__/AssistantScreen.test.tsx` — renders streamed prose incrementally from `chat-store`; the terminal `draft` event populates a "Datos extraídos" extraction panel; a mid-stream error shows a retry affordance without losing the prior draft state; navigation away/unmount aborts the turn.
- [ ] 8.2 GREEN: Create `apps/mobile/src/screens/create-plan/AssistantScreen.tsx` (chat pane + extraction panel, parity with web `AssistantPane`) consuming `chat-store.ts`/`chat-stream.ts` from C2a and `plan-draft-client.ts` from C1.
- [ ] 8.3 GREEN: Add screen styles (`*.styles.ts`) and wire `AssistantScreen` into the existing react-navigation entry for create-plan.
- [ ] 8.4 RED: Add a failing i18n parity test extending the `packages/i18n` suite — the `chat` namespace strings needed by the mobile Asistente/extraction UI are present with EN/ES parity (reuse/extend the item-12 `chat` namespace; no new namespace needed here).
- [ ] 8.5 GREEN: Extend `packages/i18n/src/messages/{en,es}.json` with any mobile-specific `chat` namespace keys needed for parity.
- [ ] 8.6 TRIANGLE: Run `pnpm --filter mobile test -- src/screens/create-plan/__tests__/AssistantScreen.test.tsx` + `pnpm --filter i18n test` green; `pnpm -w typecheck`; manual smoke on an Expo dev client/simulator (type-drive a full extraction turn end-to-end, matching web Asistente behavior); confirm Track C now reaches web parity — this MUST be true before Track D (mobile voice) begins.

---

## Track D — Mobile Voice (depends on Track A and Track C)

## Phase 9: Slice D1 — Expo Mic Capture + "Asistente de Voz" Screen → Transcribe → RN Chat [Requirements: Voice Interaction and Microphone Permission (Web and Mobile), Mobile Create-Plan Voice Parity, Offline Voice Degradation]

- [ ] 9.1 RED: Add failing `apps/mobile/src/audio/__tests__/recorder.test.ts` (mocked `expo-audio`) — permission granted → records to an `.m4a` file URI; permission denied → returns a graceful denial signal, no crash; no `openai`/LLM import.
- [ ] 9.2 GREEN: Create `apps/mobile/src/audio/recorder.ts` using `expo-audio`; add `expo-audio` to `apps/mobile/package.json`.
- [ ] 9.3 RED: Add failing `apps/mobile/src/screens/voice/__tests__/VoiceScreen.test.tsx` — orb state machine transitions `Listo → Escuchando → Procesando → kInorA responde`; push-to-talk triggers `recorder.ts` → direct `POST {API}/plan-specs/transcribe` (Bearer from `expo-secure-store`, no proxy, unlike web) → on success feeds the transcript into the C2a/C2b RN chat turn; `unclear`/empty transcript → re-prompt, no chat turn started; mic-denied → text-input fallback, RN chat still fully usable typed; offline → voice affordance disabled/degraded with text usable, no crash; connectivity restored → voice re-enabled without reload.
- [ ] 9.4 GREEN: Create `apps/mobile/src/screens/voice/VoiceScreen.tsx` (the OD "Asistente de voz" screen) wiring `recorder.ts` → direct transcribe call → `chat-store.ts` (C2a) turn → `AssistantScreen`-equivalent rendering (C2b); mic-denied and offline handling.
- [ ] 9.5 TRIANGLE: Run `pnpm --filter mobile test -- src/audio/__tests__/recorder.test.ts src/screens/voice/__tests__/VoiceScreen.test.tsx` green; `pnpm -w typecheck`; `scripts/deps-guard.mjs` clean; manual smoke on device/simulator (permission prompt, denial fallback, offline degrade/recover, transcribe→chat end-to-end matching web voice UX).

## Phase 10: Slice D2 — Native TTS Playback + Parity with Web Voice [Requirements: TTS Opt-Out Preference, Voice Billing Boundary, Mobile Create-Plan Voice Parity]

- [ ] 10.1 RED: Add failing `apps/mobile/src/audio/__tests__/player.test.ts` (mocked `expo-audio`) — plays `mp3` bytes returned from `POST {API}/plan-specs/speech` for the terminal reply; a `204` (opted out) response → no playback attempt, no crash; no persistence of audio bytes anywhere.
- [ ] 10.2 GREEN: Create `apps/mobile/src/audio/player.ts` (native `mp3` playback via `expo-audio`) — calls the speech endpoint directly (Bearer), plays only on `200`, skips cleanly on `204`.
- [ ] 10.3 RED: Extend `VoiceScreen.test.tsx` — a full turn (transcribe → chat → optional TTS) matches web voice's state sequence; a billing-quota spy asserts zero units consumed across transcribe/chat/speech calls in a voice session, and the existing confirm→generate gate (unchanged, reused) still consumes exactly one `plan_generation` unit when the user confirms.
- [ ] 10.4 GREEN: Wire `player.ts` into `VoiceScreen.tsx` after the terminal `assistantMessage`; extend the shared `voice` i18n namespace (from B2) in `packages/i18n/src/messages/{en,es}.json` with any mobile-specific strings, preserving EN/ES parity.
- [ ] 10.5 TRIANGLE: Run the full mobile voice suite (`recorder`, `player`, `VoiceScreen`) + `pnpm --filter i18n test` green; `pnpm -w typecheck`; `scripts/deps-guard.mjs` clean across `apps/mobile` (confirm no `openai` import anywhere in mobile); manual smoke on device/simulator matching web voice UX end-to-end; confirm the change's success criteria are met: mobile voice reaches parity with web, EN/ES i18n parity holds across web and mobile voice, and no per-turn billing unit is introduced.
