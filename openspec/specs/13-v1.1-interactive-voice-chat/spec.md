# 13-v1.1-interactive-voice-chat Specification

## Purpose

Enable a voice layer over item 12's interactive text chat for create-plan: users push-to-talk to
speak their goals and constraints, the audio is transcribed via Whisper, the transcript drives the
EXISTING `POST /plan-specs/chat` extraction turn byte-for-byte (12, reused unchanged), and the
assistant's reply is optionally read back via OpenAI TTS. Voice is the "Asistente de voz" companion
to 12's "Asistente" — never a separate brain, never a new extraction/draft/gate/SSE path.

This spec maps to the mobile voice assistant Open Design screen and remains v1.1 scope. Voice is a
Pro feature, fail-closed on every new endpoint exactly like the item-12 chat gate, and consumes no
billing quota — only the existing confirm → generate step consumes `plan_generation`. It ships on
BOTH web (an affordance inside the existing `AssistantPane`) and mobile (Expo React Native, on a new
RN create-plan chat foundation built specifically to carry mobile voice, since item 12 shipped
web-only).

## Requirements

### Requirement: Speech-to-Text Transcription Endpoint

`POST /plan-specs/transcribe` MUST accept a multipart audio upload and return `{ text }` — the Whisper-transcribed transcript — WITHOUT ever persisting the raw audio. The endpoint MUST transcribe the blob in-flight and discard it; no audio bytes may be written to storage, logs, or observability. The transcription MUST run behind a LangChain-independent OpenAI-audio port (`SpeechTranscriber`) in `apps/api/src/ai/`, using a dedicated `OPENAI_API_KEY` decoupled from the dynamic `ai_provider_config` chat provider. The transcript is the ONLY output; the endpoint MUST NOT itself run extraction, drafting, or generation. Silence, noise, or an otherwise unintelligible recording MUST return a deterministic "could not understand" result WITHOUT crashing or writing a bad draft.

#### Scenario: Voice input transcribed

- GIVEN a Pro user uploads a spoken recording of "build muscle four days a week with just dumbbells"
- WHEN `POST /plan-specs/transcribe` processes the audio
- THEN it returns `{ text }` with the transcript and no audio blob is persisted anywhere

#### Scenario: Silence or noise returns "could not understand"

- GIVEN a user uploads a recording of silence or background noise
- WHEN the STT port processes the audio
- THEN the endpoint returns a deterministic "could not understand, please try again" signal without crashing and writes nothing to the draft

#### Scenario: Raw audio is never persisted

- GIVEN any transcription request (successful or failed)
- WHEN the endpoint finishes
- THEN the audio blob is discarded in-flight and no raw audio is written to storage, logs, or the vector store

#### Scenario: Transcription error fails safe

- GIVEN the OpenAI audio call errors or times out
- WHEN the turn aborts
- THEN the endpoint returns a safe error result, no audio is retained, and no draft is written

### Requirement: Audio Upload Validation and Caps

`POST /plan-specs/transcribe` MUST enforce audio size and duration caps and accept only supported audio content types, rejecting oversize, over-duration, or unsupported uploads BEFORE any OpenAI call. The client SHOULD also enforce caps to fail fast, but the server cap is the enforcement boundary and MUST NOT be bypassable from the request body or headers.

#### Scenario: Oversize audio rejected before OpenAI call

- GIVEN a user uploads audio exceeding the server size or duration cap
- WHEN the endpoint validates the upload
- THEN the request is rejected with a validation error and no OpenAI transcription call is made

#### Scenario: Unsupported format rejected

- GIVEN a user uploads a file whose content type is not a supported audio format
- WHEN the endpoint validates the upload
- THEN the request is rejected with a validation error before any transcription work

#### Scenario: Empty or missing audio handled safely

- GIVEN a request with no audio part or a zero-byte blob
- WHEN the endpoint validates the upload
- THEN it returns a validation error and prompts the client to record again; no OpenAI call runs

### Requirement: Text-to-Speech Speech Endpoint

`POST /plan-specs/speech` SHOULD convert a text input (the terminal `assistantMessage`) to audio bytes via an OpenAI TTS port in `apps/api/src/ai/`, using the same dedicated `OPENAI_API_KEY`. It MUST NOT persist generated audio. Playback is play-**after**-turn in v1 — the endpoint speaks the completed terminal reply and MUST NOT be a streamed/incremental per-token TTS. It MUST enforce the OpenAI input character cap.

#### Scenario: Response read aloud after the turn completes

- GIVEN a Pro user with TTS enabled and a completed chat turn producing a terminal `assistantMessage`
- WHEN the client calls `POST /plan-specs/speech` with that text
- THEN the endpoint returns audio bytes for after-turn playback and persists no audio

#### Scenario: Over-length text capped

- GIVEN a text input exceeding the TTS input character cap
- WHEN the endpoint validates the input
- THEN it is rejected or safely truncated per the cap and no oversized request is sent to OpenAI

### Requirement: TTS Opt-Out Preference

The system MUST persist a per-user TTS opt-out preference (the only data-model change in this capability, a minimal preference column). When a user has opted out, the client MUST NOT request or play TTS audio; only the text reply is shown. The preference MUST be readable and writable per authenticated user, tenant-scoped from `authContext`.

#### Scenario: TTS enabled plays audio

- GIVEN a user whose TTS preference is enabled
- WHEN the AI produces a terminal reply
- THEN the reply is converted to speech and played on the device

#### Scenario: TTS opt-out respected

- GIVEN a user who has disabled TTS in settings
- WHEN the AI produces a terminal reply
- THEN only the text response is displayed and no `POST /plan-specs/speech` call or playback occurs

### Requirement: Voice Endpoint Pro Gate (Fail-Closed)

Both `POST /plan-specs/transcribe` and `POST /plan-specs/speech` MUST require effective tier Pro, resolved via the existing `ChatEntitlementPort` / `ChatEntitlement` from `authContext` — NEVER from the request body. A Free or expired-trial tenant MUST be denied fail-closed with a `premium_required`-style denial BEFORE any OpenAI STT/TTS call runs. Any tier/tenant value in the request body MUST be ignored. Voice is a Pro feature; a Free token MUST be rejected on every voice endpoint regardless of client UI state.

#### Scenario: Pro tenant allowed on voice endpoints

- GIVEN an active member of a Pro tenant
- WHEN they call `POST /plan-specs/transcribe` or `POST /plan-specs/speech`
- THEN the gate passes and the STT/TTS work proceeds

#### Scenario: Free tenant denied before OpenAI work

- GIVEN a member of a Free tenant
- WHEN they call `POST /plan-specs/transcribe` or `POST /plan-specs/speech`
- THEN the request is rejected fail-closed with an upgrade-required denial and no OpenAI call is made

#### Scenario: Body tier spoof ignored

- GIVEN a Free tenant sends a body claiming `tier="pro"`
- WHEN the endpoint resolves entitlement
- THEN tier is read only from `authContext`, the body is ignored, and the request is denied

#### Scenario: Expired trial denied

- GIVEN a tenant whose trial has expired to Free
- WHEN they call a voice endpoint
- THEN the request is denied fail-closed before any OpenAI STT/TTS work

### Requirement: Voice Reuses the Existing Chat Path Unchanged

Voice MUST NOT re-implement extraction, drafting, masking, the SSE stream, or the confirm/generate gate. The transcript returned by `POST /plan-specs/transcribe` MUST be fed into the EXISTING `POST /plan-specs/chat` SSE turn byte-for-byte as if it were typed text, producing the same validated `Partial<PlanSpec>` draft. Health, limitation, and voice-biometric-derived text MUST inherit item-12 masking because the transcript flows through the existing chat path; no separate masking path may be introduced. No raw transcript may be embedded as vector memory. All voice state and access MUST be tenant-scoped from `authContext`.

#### Scenario: Transcript feeds the existing chat turn

- GIVEN a transcript "build muscle four days a week with just dumbbells" from `POST /plan-specs/transcribe`
- WHEN the client feeds it into the existing `POST /plan-specs/chat` turn
- THEN the same draft is produced as if the text had been typed (`goal="hypertrophy"`, `daysPerWeek=4`, `equipment=["dumbbells"]`)

#### Scenario: Health text masked via the existing path

- GIVEN a spoken turn containing limitation/health details
- WHEN the transcript flows through `POST /plan-specs/chat`
- THEN the sensitive text is masked by the existing chat masking before reaching the LLM/observability

#### Scenario: No raw transcript embedding

- GIVEN a voice chat session with ordinary or sensitive turns
- WHEN the session ends
- THEN no raw transcript is embedded into the vector store

#### Scenario: Tenant scoping enforced

- GIVEN a member authenticated in tenant T
- WHEN voice endpoints read or write any state
- THEN only T's data is accessed, derived from `authContext`

### Requirement: Voice Billing Boundary

Voice turns (transcription, TTS, and the chat turns they drive) MUST consume NO billing quota. Only the existing confirm → generate step MUST consume exactly one `plan_generation` unit, unchanged. No per-turn STT/TTS meter may be introduced in this change.

#### Scenario: Voice turn consumes no quota

- GIVEN a Pro tenant runs several voice transcribe → chat → TTS turns
- WHEN the turns complete
- THEN no billing unit is consumed for any turn

#### Scenario: Confirm consumes exactly one plan_generation

- GIVEN a reviewed draft assembled via voice
- WHEN the user confirms to generate
- THEN exactly one `plan_generation` unit is consumed at the existing confirm gate

### Requirement: Voice Interaction and Microphone Permission (Web and Mobile)

Voice interaction MUST be push-to-talk in v1 on both web and mobile. The client MUST request microphone permission before capture and MUST handle denial gracefully by falling back to text input WITHOUT crashing. The UI MUST surface listening, processing, and speaking states. Voice is an affordance within the existing Asistente flow (web) and the OD "Asistente de voz" screen (mobile), never a separate brain. Voice is a Pro feature; Free users MUST NOT see a working voice affordance. Web voice code and mobile voice code MUST NOT import `openai`/LLM libraries — they only ship audio bytes and play audio.

#### Scenario: Microphone denied falls back to text

- GIVEN the user blocks microphone access
- WHEN they attempt voice input
- THEN the system shows a "microphone access required" message and falls back to text input without crashing

#### Scenario: Listening and processing states shown

- GIVEN a Pro user holds push-to-talk and speaks
- WHEN the recording is captured and uploaded
- THEN the UI shows a listening state during capture and a processing state during transcription, then the assistant's response state

#### Scenario: Free user sees no working voice

- GIVEN a Free tenant on create-plan
- WHEN the screen loads
- THEN no working voice affordance is offered; they see the existing text/Formulario flow and the upgrade CTA

### Requirement: Offline Voice Degradation

Voice requires the network. When the client is offline or the voice endpoints are unreachable, the voice affordance MUST degrade to disabled/text fallback and MUST NOT crash. Recovery MUST be graceful: when connectivity returns, voice becomes available again without a reload requirement.

#### Scenario: Offline disables voice with text fallback

- GIVEN the client is offline
- WHEN the user opens the Asistente / voice screen
- THEN the voice affordance is disabled or degraded, text input remains usable, and nothing crashes

#### Scenario: Connectivity restored re-enables voice

- GIVEN voice was degraded while offline
- WHEN connectivity returns
- THEN the voice affordance becomes available again gracefully

### Requirement: Mobile Create-Plan Voice Parity

The mobile (Expo React Native) voice experience MUST reach functional parity with web voice (transcribe → existing chat turn → optional TTS), built on a new RN create-plan chat foundation (plan-draft client + auth wiring + RN SSE reader + Asistente/extraction UI) because `apps/mobile` has no create-plan chat today. The RN chat foundation MUST reach parity with the web chat BEFORE mobile voice is layered on it. The OD "Asistente de voz" mobile screen is the UI reference (its in-workout demo copy is illustrative only; shipped behavior is create-plan voice). EN/ES i18n parity MUST be maintained across web and mobile voice.

#### Scenario: Mobile voice reaches parity with web

- GIVEN the RN create-plan chat foundation is in place and at parity with web chat
- WHEN a Pro mobile user uses voice
- THEN they can transcribe → drive the existing chat turn → optionally hear the reply, matching web voice behavior

#### Scenario: Mobile chat foundation precedes mobile voice

- GIVEN mobile has no create-plan chat surface
- WHEN mobile voice is planned
- THEN the RN chat foundation (draft client, auth, SSE reader, Asistente/extraction UI) is delivered to web parity before voice UI is added

#### Scenario: Voice i18n parity

- GIVEN the voice UI on web and mobile
- WHEN it renders in EN or ES
- THEN all voice strings are present with EN/ES parity from the voice i18n namespace

## Notes

- **Audio caps**: server-enforced 15 MB size cap and ~120 s soft duration cap; supported content-type allow-list is `audio/webm`, `audio/mp4`, `audio/x-m4a` (Safari/iOS PWA), `audio/m4a` (Expo RN), `audio/mpeg`, `audio/wav`. Rejected before any OpenAI call.
- **STT/TTS models**: STT is pinned to `whisper-1` (not `gpt-4o-transcribe`/`mini`); TTS is `gpt-4o-mini-tts`, voice `alloy`, `mp3` output — both pinned in a single adapter constant behind `SpeechTranscriber`/`SpeechSynthesizer` ports so a future model swap is a one-line adapter change.
- **Denial status**: the Pro-gate denial follows item 12's design — `403 { error: "premium_required" }` (or the specific lapsed reason) before any OpenAI work, consistent with the existing `BillingDenialReason` → 403 convention.
- **RN SSE transport**: the RN chat foundation reads `text/event-stream` via a hand-rolled XHR-chunked reader (POST + `Authorization: Bearer`, reading `xhr.responseText` deltas), reusing the SAME ported pure frame parser as the web SSE reader — chosen because RN `fetch` does not expose `response.body` as a stream and `EventSource` cannot POST + set a Bearer header. No `react-native-sse` dependency was added; the parser stays project-owned to avoid divergence from the web parser.
- **Capture format**: web `MediaRecorder` selects `audio/webm;codecs=opus` (Chrome/Firefox) with `audio/mp4` fallback (Safari); mobile uses `expo-audio` to capture `.m4a`. Push-to-talk with a gesture-anchored first playback (the mic-press gesture anchors the subsequent `<audio>`/native `.play()` call).
- **TTS preference storage**: a nullable `tts_enabled` boolean column on the existing `user_preferences` table (NULL/true = enabled — opt-out default is ON; false = opted out), carried through the existing partial-merge upsert and `GET`/`PUT /user-preferences` surface.
- **Mobile track sequencing**: Track C (RN plan-draft client, RN SSE reader/turn lifecycle, RN Asistente/extraction UI) is the dominant effort of this change and was delivered and verified at parity with the web chat before Track D (mobile voice UI) began, per the shipped PR order.
