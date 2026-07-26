# Proposal: 13 — Interactive Voice Chat (v1.1 voice companion to create-plan)

## Intent

Let users create a workout plan by **speaking** their goals and constraints, then hear the
assistant's reply read back — a voice layer on top of the item-12 text chat, not a new brain.
The user pushes to talk → the audio is transcribed by Whisper → the **existing**
`POST /plan-specs/chat` extraction turn (12) runs byte-for-byte → the assistant prose is
(optionally) spoken back via OpenAI TTS. Voice is the "Asistente de voz" companion to 12's
"Asistente".

This change is deliberately **additive and reuse-first**: it introduces a thin transcription
endpoint and an optional speech endpoint, plus voice UI affordances, and touches the proven
extraction / draft / gate / generate path **not at all**. It is delivered on **BOTH web and
mobile**. The mobile track is the bulk of the effort because `apps/mobile` (Expo React Native)
has **no create-plan / chat flow at all today** — item 12 shipped web-only — so mobile voice
first requires building an RN create-plan chat foundation.

## Target Users

- **Pro tenants** on web and mobile who prefer describing intent by voice ("build muscle four
  days a week with just dumbbells") over typing or stepping through the card wizard.
- Users in hands-busy or on-the-go contexts (especially mobile) where speaking is faster than
  typing a multi-field plan spec.
- Users who want the assistant's reply read aloud, and users who explicitly do **not** — TTS is
  opt-out via a settings preference.
- **Free tenants** keep the existing text/Formulario flows; voice is a **Pro feature**, gated
  fail-closed on every new endpoint exactly like the item-12 chat gate.
- Voice turns consume **no billing quota**, exactly like text chat turns; only the existing
  `confirm → generate` step consumes `plan_generation`.

## Scope

### In Scope

- **Voice is a Pro feature, fail-closed.** Every new endpoint (`/plan-specs/transcribe`,
  `/plan-specs/speech`) reuses the existing `ChatEntitlementPort` / `ChatEntitlement`
  (`apps/api/src/billing/chat-entitlement.ts`): Pro-only, tenant/user resolved from
  `authContext` (never the request body), fail-closed before any OpenAI call, consumes no quota.
- **Reuse item 12's chat path UNCHANGED.** Voice never re-implements extraction, drafting,
  masking, the SSE stream, or the confirm/generate gate. STT produces text; the client feeds
  that text into the **existing** `POST /plan-specs/chat` SSE turn. Only `confirm → generate`
  consumes `plan_generation`; voice turns consume none.
- **Endpoint shape = thin transcribe + reuse chat (Approach A).**
  - New **`POST /plan-specs/transcribe`**: multipart audio in → `{ text }` out. Whisper
    (`whisper-1`, exact model pinned at design). Authenticated, Pro-gated, tenant-scoped,
    client + server size/duration caps, **no audio persistence** (transcribe in-flight, discard
    the blob). Returns a "could not understand" signal on silence/noise without crashing.
  - Optional **`POST /plan-specs/speech`**: text in → audio out (OpenAI TTS), behind a per-user
    **TTS opt-out preference**. Play-**after**-turn in v1 (TTS the terminal `assistantMessage`),
    not streamed/incremental.
- **OpenAI-only STT/TTS with a dedicated key.** Add the `openai` npm SDK to **`apps/api` only**
  (deps-guard-clean — `openai` is an AI pattern and `apps/api` is AI-allowed; it MUST NOT leak
  into web or mobile). STT/TTS use a **dedicated `OPENAI_API_KEY`**, independent of the dynamic
  `ai_provider_config` used for chat/extraction — because Whisper/TTS are OpenAI-specific and do
  not fit the multi-provider abstraction. New port(s) in `apps/api/src/ai/`
  (`SpeechTranscriber`, and a speech/TTS port) mirroring `PlanSpecExtractor`, each with a
  LangChain-independent OpenAI-audio adapter and a deterministic **Mock** for tests.
- **Web voice UI** inside the existing `AssistantPane`
  (`apps/web/src/app/(app)/create-plan/AssistantPane.tsx`): mic capture via `getUserMedia` +
  `MediaRecorder` (**push-to-talk**), OD-inspired orb / listening states adapted to web,
  transcribe → feed the transcript into the existing chat turn, and a **mic-denied text
  fallback**. TTS playback via `<audio>` (gesture-anchored, opt-out). Voice is an **affordance
  within the Asistente flow**, not a separate mode. New **voice i18n namespace** (EN/ES parity).
- **Mobile create-plan chat foundation (prerequisite).** Because `apps/mobile` has no
  create-plan / chat surface, build the RN foundation first: a plan-draft client + auth wiring,
  an RN SSE reader, and the Asistente / extraction UI reaching **parity with the web chat**.
  This is the largest part of the change and is expected to span several slices.
- **Mobile voice UI** on top of that foundation: Expo mic capture + the OD "Asistente de voz"
  mobile screen (voice orb, `Listo → Escuchando → Procesando → kInorA responde` states,
  transcript, push-to-talk), transcribe → chat, and native TTS playback at parity with web
  voice behavior.
- **Create-plan companion per spec.** Voice drives **plan definition** (STT → chat →
  extraction), honoring the canonical spec and item-12 reuse. The OD in-workout demo copy
  ("Sube el peso del press…") is **illustrative only**; the shipped behavior is create-plan
  voice.
- **Privacy discipline inherited from 12.** Never persist raw audio; no raw-transcript vector
  embedding; health/limitation text masking is inherited because the transcript flows through
  the existing `/plan-specs/chat`; Pro gate + tenant scope on every new endpoint; observability
  metadata is safe-fields-only. Record OpenAI audio-API data-handling terms.
- **Offline degrades gracefully.** Voice requires the network; offline → degrade to text /
  disabled affordance, never a crash.

### Out of Scope (non-goals)

- **Barge-in** (interrupting TTS playback by speaking) — deferred.
- **Continuous / always-listening capture** — v1 is push-to-talk only.
- **Streamed / incremental (sentence-chunked) TTS** — v1 speaks after the turn completes.
- **Raw-audio persistence** of any kind — audio is transcribed in-flight and discarded.
- **Any per-turn billing meter for STT/TTS** — voice turns consume no unit in v1; the Pro gate
  is the control. A future STT/TTS abuse meter is **noted** but not built here.
- **In-workout voice coaching** (the OD demo scenario) — 13 is create-plan voice only.
- **Any change to the item-12 extraction / draft / SSE chat / promote / confirm / generate
  path** — those are reused unchanged.
- **Raw-transcript vector embedding / broad chat memory** — remains deferred per 12.

## Approach

- **Thin transcribe + reuse chat (Approach A).** The client records push-to-talk audio, uploads
  it to `POST /plan-specs/transcribe`, receives `{ text }`, and feeds that text into the
  **existing** `POST /plan-specs/chat` SSE turn — so the extraction/draft/gate/SSE path is
  byte-identical to item 12. The optional `POST /plan-specs/speech` converts the terminal
  `assistantMessage` to audio for after-turn playback. Two extra round-trips per voice turn is
  the accepted tradeoff for a near-zero blast radius; a combined `voice-chat` SSE endpoint is
  explicitly rejected (duplicates SSE plumbing, drift risk vs 12).
- **Hexagonal confinement.** All OpenAI audio calls live behind new ports in
  `apps/api/src/ai/`, LangChain-independent, each with a Mock. Web and mobile only ship audio
  bytes and play audio — never import `openai`/LLM libs (`scripts/deps-guard.mjs` bans
  `openai|@ai-sdk|langchain|langfuse` outside `apps/api`; adding `openai` to `apps/api` is
  deps-guard-clean).
- **Dedicated OpenAI key, decoupled from the chat provider.** STT/TTS read a dedicated
  `OPENAI_API_KEY`, never the dynamically-resolved `ai_provider_config` provider — voice is
  documented as OpenAI-only.
- **Fail-closed Pro gate + tenant scope on every new endpoint,** reusing `ChatEntitlementPort`,
  resolving tenant/user from `authContext`, rejecting Free before any OpenAI work.
- **No new audio persistence and no schema change beyond a TTS preference.** The only data model
  change is a TTS opt-out preference column; audio is never stored; transcripts flow through the
  existing masked chat path.
- **Mobile is a foundation-first track.** Mobile voice cannot be built directly because RN has
  no create-plan chat. Track C ports the create-plan chat to RN (plan-draft client, SSE reader,
  Asistente/extraction UI) to parity with web; only then does Track D add voice UI. The proposal
  is honest that Track C is the bulk of the effort.
- **UI reuse.** Web voice adapts the OD orb/states into the existing `AssistantPane`; mobile
  voice implements the OD "Asistente de voz" screen on top of the new RN chat foundation.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api` deps | Modified | add `openai` SDK (apps/api only; deps-guard-clean) |
| `apps/api/src/ai/` | New | `SpeechTranscriber` port + OpenAI-audio adapter + Mock; TTS/speech port + adapter + Mock |
| `apps/api/src/routes/plan.ts` | Modified | new `POST /plan-specs/transcribe` (multipart, Pro-gated, tenant-scoped, caps, no persistence) + optional `POST /plan-specs/speech` (TTS) |
| `apps/api/src/billing/chat-entitlement.ts` | Reused | Pro gate on both new endpoints, fail-closed |
| env / config | New | dedicated `OPENAI_API_KEY` for STT/TTS |
| DB migration | New (minimal) | TTS opt-out preference column |
| `apps/web` create-plan `AssistantPane.tsx` | Modified | mic capture (getUserMedia/MediaRecorder push-to-talk), OD orb/states, transcribe→chat, mic-denied fallback, `<audio>` TTS playback |
| `apps/mobile` create-plan (chat) | New | RN plan-draft client + auth, SSE reader, Asistente/extraction UI (parity with web) — the large prerequisite |
| `apps/mobile` voice screen | New | Expo mic capture + OD "Asistente de voz" screen + native TTS playback |
| `packages/i18n/src/messages/{en,es}.json` | Modified | new voice namespace (EN/ES parity) |

## Slicing (chained PRs, ~one session each, ≤~200 authored lines, TDD-able)

Grouped into four tracks. **Track A (shared API)** and **Track B (web voice)** ship voice on the
already-shipped web foundation. **Track C (mobile foundation)** is the large prerequisite that
ports create-plan chat to RN; **Track D (mobile voice)** depends on C. A and C can proceed in
parallel; B depends on A; D depends on both A and C.

### Track A — shared API (backend, reusable by web and mobile)

- **A1 — `openai` SDK + `SpeechTranscriber` port + OpenAI-audio adapter + Mock.**
  Add the `openai` package to `apps/api` (deps-guard-clean); new `SpeechTranscriber.transcribe`
  port in `apps/api/src/ai/`, a LangChain-independent OpenAI-audio adapter (whisper-1, exact
  model pinned at design), and a deterministic Mock. Unit-tested against the Mock. **Boundary:
  no HTTP route, no UI, no billing change.**
- **A2 — `POST /plan-specs/transcribe`.** Multipart audio → `{ text }`. Authenticated, Pro gate
  (fail-closed via `ChatEntitlementPort`), tenant-scoped from `authContext`, client+server
  size/duration caps, **no audio persistence**, "could not understand" signal on silence/noise.
  Tests: Free-denied / Pro-allowed, cap enforcement, no-persistence, empty/noise handling.
- **A3 — `POST /plan-specs/speech` (TTS) + TTS opt-out preference.** Text → audio behind the
  new per-user TTS preference (the minimal preference column + read/write). Play-after-turn
  contract. Same Pro gate + tenant scope. Tests: preference on/off, Pro gate, no persistence.

### Track B — web voice (depends on A)

- **B1 — web mic capture + transcribe → existing chat turn.** `getUserMedia` + `MediaRecorder`
  push-to-talk in `AssistantPane`, OD-inspired orb / listening states adapted to web, upload to
  `/plan-specs/transcribe`, feed the returned text into the **existing** chat SSE turn,
  mic-denied → text fallback. **Boundary: web sends audio + text, renders only; no LLM/openai
  import.**
- **B2 — web TTS playback + voice i18n.** `<audio>` gesture-anchored playback of the terminal
  `assistantMessage` via `/plan-specs/speech`, honoring the opt-out preference; new voice i18n
  namespace (EN/ES parity).

### Track C — mobile create-plan chat foundation (prerequisite, large — expect multiple slices)

- **C1 — RN plan-draft client + auth wiring.** Port the create-plan draft/promote/confirm client
  calls and session/auth wiring into `apps/mobile` (no LLM import). Unit/integration tested.
- **C2 — RN SSE reader + Asistente/extraction UI (parity with web).** An RN SSE reader (fetch
  streaming / RN-compatible transport) and the Asistente chat + "Datos extraídos" extraction UI
  reaching parity with the web chat. **This is the big one and MAY span several slices** (e.g.
  C2a SSE transport + turn lifecycle, C2b Asistente/extraction UI + i18n). Split as needed to
  keep each slice ≤~200 authored lines.

### Track D — mobile voice (depends on A and C)

- **D1 — Expo mic capture + OD "Asistente de voz" screen → transcribe → chat.** Expo mic
  capture, the OD mobile-voice screen (orb, `Listo → Escuchando → Procesando → kInorA responde`
  states, transcript, push-to-talk), upload to `/plan-specs/transcribe`, feed text into the RN
  chat turn from Track C, mic-denied fallback.
- **D2 — native TTS playback + parity with web voice.** Native audio playback of the terminal
  reply via `/plan-specs/speech`, honoring the opt-out preference, matching web voice behavior.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Platform mismatch: OD "voice" is mobile, but item-12 chat is web-only | High | Deliver both explicitly; sequence Track C (RN chat foundation) before Track D; do not silently ship a diverging web-only UI |
| Missing `openai` SDK in the API | High | Add `openai` to `apps/api` only (deps-guard-clean); confirm no leak into web/mobile via deps-guard |
| Provider-abstraction break (STT/TTS bypass `ai_provider_config`) | Med | Dedicated `OPENAI_API_KEY` for voice, decoupled from the chat provider; document voice is OpenAI-only |
| iOS Safari MediaRecorder + autoplay quirks (PWA) | Med | Feature-detect capture format (webm/opus vs mp4); keep first `.play()` gesture-anchored; test on iOS Safari |
| Expo mic / native audio integration | Med | Use supported Expo audio APIs; permission request + graceful denial fallback; test on device |
| Health / voice-biometric audio privacy | High | Never persist raw audio; no raw-transcript embedding; masking inherited via existing chat path; Pro gate + tenant scope on every endpoint; record OpenAI audio data-handling terms |
| STT/TTS marginal cost with no meter | Med | Pro gate limits exposure; size/duration caps; monitor; add abuse meter later (noted, not built) |
| Double round-trip latency (transcribe then chat) | Med | Accepted for v1 (smallest blast radius); revisit a combined endpoint only if latency proves unacceptable |
| Mobile-foundation size risk (Track C is large) | High | Foundation-first sequencing; split C2 into multiple ≤~200-line slices; be explicit that Track C is the bulk of the effort |
| Silence / noise producing garbage transcripts | Med | Server returns "could not understand" signal; client re-prompts without crashing |
| Audio size/format abuse | Med | Client + server size/duration caps; validated content types |

## Rollback Plan

Purely additive: new endpoints and new UI, with the **only** schema change being a TTS-preference
column. No change to existing endpoints or migrations beyond that column. Rollback is per slice:

- **Track D** (mobile voice): remove the Expo voice screen + native playback; the RN chat
  foundation (C) still works as text.
- **Track C** (mobile foundation): remove the RN create-plan chat; existing mobile
  tracker/history/home flows are unaffected (they never depended on it).
- **Track B** (web voice): remove mic capture + orb + `<audio>` playback + voice i18n from
  `AssistantPane`; the item-12 text Asistente is unaffected.
- **Track A** (shared API): remove `/plan-specs/transcribe` + `/plan-specs/speech` + the audio
  ports; drop the `openai` dependency; the TTS-preference column is inert if unused and can be
  dropped in a follow-up migration.

The item-12 chat, drafts, and generation continue functioning at every rollback point.

## Relation to README roadmap

Implements roadmap item **13 — v1.1 interactive voice chat**: the "Asistente de voz" voice
companion that adds Whisper STT and OpenAI TTS on top of item **12**'s conversational
create-plan text chat (extraction → shared `plan_drafts` → existing confirm/generate). It reuses
12's extraction/draft/gate/SSE path unchanged and the 11a/11b billing Pro gate, and delivers on
**both web and mobile** — with mobile requiring a new RN create-plan chat foundation because item
12 shipped web-only.

## Dependencies

- **12 interactive text chat** — merged; the entire chat/extraction/draft/gate/SSE foundation,
  reused unchanged. Track C ports this to RN.
- **07 card wizard** (drafts, promote, confirm) — merged; the shared `plan_drafts` model.
- **08 AI plan generation** + `apps/api/src/ai/` port/adapter pattern — merged; voice ports
  mirror `PlanSpecExtractor`.
- **11a/11b billing** — merged; `ChatEntitlementPort` reused as the fail-closed Pro gate;
  `plan_generation` consumed only at confirm.
- **`openai` SDK** — new dependency in `apps/api` (deps-guard-clean).
- **Dedicated `OPENAI_API_KEY`** — new env/config, independent of `ai_provider_config`.
- **Open Design** `docs/open-design/kinora/screens/mobile-voice.html` "Asistente de voz" as the
  mobile reference (in-workout demo copy is illustrative only); web adapts the OD orb/states into
  the existing Asistente.

## Success Criteria

- [ ] A spoken description is transcribed via `POST /plan-specs/transcribe` and fed into the
      **existing** `POST /plan-specs/chat` turn, producing the same validated draft as typed text.
- [ ] Silence/noise returns a "could not understand" prompt without crashing.
- [ ] AI replies are read aloud via `POST /plan-specs/speech` when TTS is enabled, and silent
      when the user has opted out.
- [ ] Microphone permission is requested; denial falls back gracefully to text input.
- [ ] Every new endpoint is Pro-gated fail-closed, tenant-scoped from `authContext`, and consumes
      no billing quota; only confirm consumes `plan_generation`.
- [ ] Raw audio is never persisted; transcripts inherit item-12 masking via the existing chat path.
- [ ] `openai` is confined to `apps/api` (deps-guard clean); web and mobile only ship/play audio.
- [ ] STT/TTS use the dedicated `OPENAI_API_KEY`, decoupled from `ai_provider_config`.
- [ ] Mobile create-plan chat reaches parity with the web chat before mobile voice is added.
- [ ] Voice ships on both web and mobile with EN/ES i18n parity.
