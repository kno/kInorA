# Archive Report: 13-v1.1-interactive-voice-chat

## Status

- Artifact store: OpenSpec
- Task completion: 66/66 tasks complete across 10 slices / 4 tracks (`tasks.md`); no unchecked implementation tasks.
- Verification: `verify-report.md` — verdict PASS WITH WARNINGS. Build PASSED (`pnpm build`: deps-guard, architecture/depcruise, all workspace builds, `next build` with `/create-plan/transcribe` and `/create-plan/speech` routes present). All three apps' `type-check` PASSED (`apps/mobile` required a `pnpm install --frozen-lockfile` to pick up a declared-but-locally-stale `expo-audio` dependency — an environment gotcha, not a code defect). `deps-guard` and `architecture` PASSED across all 6 workspaces including `apps/mobile` (confirms `openai`/LLM code stays confined to `apps/api/src/ai/`, never leaks to web or mobile). Full test suite: 3005 passed / 0 failed / 53 skipped (pre-existing podman-gated integration tests, unrelated to this change). 10/10 requirements implemented; 29/33 scenarios fully COMPLIANT with direct runtime test coverage, 4/33 PARTIAL (none FAILING/blocking — each is an explicitly deferred, inherited-unchanged, or minor test-coverage-asymmetry gap, see Deferred Follow-ups below). 0 CRITICAL findings in the final verify pass.
- Review: adversarial 4R review across the review-flagged high-risk slices (the transcribe/speech routes on the auth + Pro-gate + external-API hot path, and C2a's RN SSE transport called out in design as "the single riskiest RN decision") surfaced 1 CRITICAL (an RN XHR-chunked SSE reader path in `chat-stream.ts`/Track C2a where a turn could fail to settle on a timeout/no-data condition) plus several MEDIUM/HIGH mic-lifecycle and resilience issues (including a TTS sentence-boundary truncation defect in A3 that was made dead code by a route-level pre-slice, and edge cases around abort-on-unmount / serialized-turn guards / gesture-anchored playback in `AssistantPane.tsx`/`VoiceScreen.tsx`). All flagged findings were fixed pre-merge with RED→GREEN test evidence before their respective PRs merged; the final verify pass found 0 CRITICAL findings remaining open (per `verify-report.md`'s Issues Found section).
- Merge reference: PR #217 (A1 — `openai` SDK + `SpeechTranscriber` port/adapter/Mock), PR #218 (A2 — `POST /plan-specs/transcribe`), PR #219 (A3 — `POST /plan-specs/speech` + TTS opt-out preference), PR #220 (C1 — RN plan-draft client + auth wiring), PR #221 (B1 — web mic capture + transcribe→existing chat turn), PR #222 (C2a — RN XHR-chunked SSE reader + turn lifecycle), PR #223 (B2 — web TTS playback + voice i18n), PR #224 (C2b — RN Asistente + extraction UI to web parity), PR #225 (D1 — Expo mic capture + "Asistente de voz" screen), PR #226 (D2 — native TTS playback + parity with web voice) — all merged to `main`.

## Source Artifacts Read

- `openspec/changes/13-v1.1-interactive-voice-chat/proposal.md` (Engram `sdd/13-v1.1-interactive-voice-chat/proposal`, obs #2404)
- `openspec/changes/13-v1.1-interactive-voice-chat/exploration.md`
- `openspec/changes/13-v1.1-interactive-voice-chat/design.md` (Engram `sdd/13-v1.1-interactive-voice-chat/design`, obs #2406)
- `openspec/changes/13-v1.1-interactive-voice-chat/tasks.md` (Engram `sdd/13-v1.1-interactive-voice-chat/tasks`, obs #2407)
- `openspec/changes/13-v1.1-interactive-voice-chat/verify-report.md` (Engram `sdd/13-v1.1-interactive-voice-chat/verify-report`, obs #2411)
- `openspec/changes/13-v1.1-interactive-voice-chat/specs/13-v1.1-interactive-voice-chat/spec.md` (delta, ADDED requirements)
- `openspec/specs/13-v1.1-interactive-voice-chat/spec.md` (canonical scaffold, pre-merge — 3 vague placeholder requirements: Speech-to-Text Input, Text-to-Speech Output, Voice Permission Handling)

## What Shipped

A **voice layer over item 12's interactive text chat** for create-plan, delivered on **both web and
mobile**. Users push-to-talk to speak their goals and constraints; the recording is transcribed via
Whisper (`whisper-1`) behind a new LangChain-independent `SpeechTranscriber` port; the transcript is
fed into the **existing, unchanged** `POST /plan-specs/chat` extraction turn (item 12) byte-for-byte,
producing the same validated `Partial<PlanSpec>` draft as typed text; the assistant's completed reply
is optionally read back via OpenAI TTS (`gpt-4o-mini-tts`, voice `alloy`, `mp3`, play-**after**-turn).
Voice reuses item 12's extraction, drafting, masking, SSE stream, and confirm/generate gate **not at
all reimplemented** — it is deliberately additive and reuse-first, touching the proven chat path only
by feeding it text exactly as a typed message would. Voice is **Pro-gated fail-closed** on every new
endpoint (`POST /plan-specs/transcribe`, `POST /plan-specs/speech`) via the existing
`ChatEntitlementPort`, tenant/user resolved from `authContext` only, and **consumes no billing
quota** — only the pre-existing confirm → generate step consumes `plan_generation`, unchanged. Raw
audio is never persisted (transcribed in-flight and discarded); no raw transcript is embedded as
vector memory; health/limitation text inherits item-12 masking because the transcript flows through
the same chat path. The only data-model change is a minimal, additive, nullable `tts_enabled`
preference column.

Because `apps/mobile` (Expo React Native) had **zero create-plan/chat surface** before this change —
item 12 shipped web-only — mobile voice required first building an entirely new RN create-plan chat
foundation (a plan-draft client, an RN SSE reader, and Asistente/extraction UI at parity with web)
before mobile voice UI could be layered on top. This foundation work (Track C) was, by design and in
practice, the dominant effort of the change.

### The 4 Tracks and Their 10 Slices/PRs

| Track | Slice | PR | Scope |
|---|---|---|---|
| A — Shared API | A1 | #217 | `openai` SDK (apps/api only, deps-guard-clean) + `SpeechTranscriber` port + OpenAI-audio adapter (`whisper-1`) + deterministic Mock. No route, no UI, no billing change. |
| A — Shared API | A2 | #218 | `POST /plan-specs/transcribe` — multipart audio → `{ text }`, Pro-gated fail-closed, tenant-scoped, 15 MB/allow-list caps, no persistence, "could not understand" taxonomy. |
| A — Shared API | A3 | #219 | `POST /plan-specs/speech` (TTS) + `tts_enabled` opt-out preference (additive migration on `user_preferences`, partial-merge upsert). |
| C — Mobile chat foundation | C1 | #220 | RN plan-draft client + `expo-secure-store` Bearer auth wiring (mirrors the web draft/promote/confirm client). |
| B — Web voice | B1 | #221 | Web mic capture (`getUserMedia`/`MediaRecorder`, push-to-talk) + transcribe → existing `runTurn(text, true)` chat turn + mic-denied/offline fallback. |
| C — Mobile chat foundation | C2a | #222 | RN XHR-chunked SSE reader (hand-rolled, no new dependency) reusing the ported pure `parseFrame` logic + turn lifecycle store (abort, serialization guard) — "the single riskiest RN decision" per design. |
| B — Web voice | B2 | #223 | Web `<audio>` gesture-anchored TTS playback + new `voice` i18n namespace (EN/ES parity). |
| C — Mobile chat foundation | C2b | #224 | RN Asistente + "Datos extraídos" extraction UI reaching parity with web `AssistantPane`. |
| D — Mobile voice | D1 | #225 | Expo mic capture (`expo-audio`) + OD "Asistente de voz" screen (orb state machine `Listo → Escuchando → Procesando → kInorA responde`) → direct transcribe call → RN chat turn. |
| D — Mobile voice | D2 | #226 | Native `mp3` TTS playback + parity with web voice + billing-boundary assertion (voice turns consume zero quota; confirm still consumes exactly one `plan_generation`). |

Merge order confirms the designed sequencing: A1/A2/A3 → C1/B1 → C2a/B2 → C2b → D1/D2 — Track C (the
mobile chat foundation) reached web parity **before** Track D (mobile voice) began, as the design
required.

## Spec Sync

| Domain | Action | Details |
|---|---|---|
| `13-v1.1-interactive-voice-chat` | Updated (canonical) | The 3 vague placeholder requirements from the pre-merge scaffold (Speech-to-Text Input, Text-to-Speech Output, Voice Permission Handling — 5 scenarios total) were superseded and replaced by the 10 concrete, precisely-specified requirements from the delta: Speech-to-Text Transcription Endpoint (4 scenarios), Audio Upload Validation and Caps (3), Text-to-Speech Speech Endpoint (2), TTS Opt-Out Preference (2), Voice Endpoint Pro Gate (Fail-Closed) (4), Voice Reuses the Existing Chat Path Unchanged (4), Voice Billing Boundary (2), Voice Interaction and Microphone Permission (Web and Mobile) (3), Offline Voice Degradation (2), Mobile Create-Plan Voice Parity (3) — 33 scenarios total, matching the verify-report compliance matrix exactly. Purpose statement rewritten to describe the voice layer over item 12, push-to-talk interaction, Pro-gated fail-closed billing boundary, and the web+mobile delivery with the RN foundation-first sequencing. Delta's trailing design-decision Notes (audio caps, STT/TTS models, denial status, RN SSE transport, capture format, TTS preference storage) preserved as canonical Notes, each resolved from "(design decision)" placeholders to the actual shipped decisions per `design.md`/`verify-report.md` (15 MB/~120s/content-type allow-list; `whisper-1`/`gpt-4o-mini-tts`+`alloy`+`mp3`; 403 `premium_required`; hand-rolled XHR-chunked reader reusing the ported parser, no new dependency; `MediaRecorder` webm/opus with mp4 Safari fallback + `expo-audio` `.m4a`; nullable `tts_enabled` column on `user_preferences`). Added a final Note on the shipped Track C→D sequencing. |

Final requirement count in the canonical spec: **10 requirements / 33 scenarios**, matching the
verify-report compliance matrix exactly (Speech-to-Text Transcription Endpoint 4, Audio Upload
Validation and Caps 3, Text-to-Speech Speech Endpoint 2, TTS Opt-Out Preference 2, Voice Endpoint Pro
Gate (Fail-Closed) 4, Voice Reuses the Existing Chat Path Unchanged 4, Voice Billing Boundary 2, Voice
Interaction and Microphone Permission (Web and Mobile) 3, Offline Voice Degradation 2, Mobile
Create-Plan Voice Parity 3).

## Warnings / Findings Preserved

- The CRITICAL (RN XHR-timeout no-settle risk in the C2a SSE reader) and the several MEDIUM/HIGH
  mic-lifecycle/resilience issues surfaced during adversarial review were fixed pre-merge with
  RED→GREEN test evidence; none remain open in the final verify pass (0 CRITICAL findings).
- verify-report's own residual WARNING/PARTIAL findings (none CRITICAL, none blocking) are carried
  forward as documented, intentionally-deferred follow-ups below.

## Archive Decision

Archive approved. Zero CRITICAL findings remain open in the final verify pass — the one CRITICAL and
several MEDIUM/HIGH issues surfaced during adversarial review across the review-flagged high-risk
slices (the transcribe/speech routes and the RN SSE transport) were fixed pre-merge with RED→GREEN
evidence recorded in `tasks.md`'s apply-progress notes. All 66 implementation tasks are `[x]` and
match the delivered code across PR #217–#226. Every required test/build/quality gate (contracts,
domain, api, web, mobile, i18n suites; all three apps' type-checks; deps-guard; architecture; full
`pnpm build`; web coverage 91.52% funcs, above the 90% threshold) passes with 0 failures across 3005
executed tests (53 pre-existing podman-gated integration tests skipped, unrelated to this change). The
4 PARTIAL spec-compliance scenarios are each either explicitly deferred in the tasks/apply artifacts
themselves (mobile real-device/simulator smoke), an inherited-but-unchanged code path from item 12
(masking/no-embedding, not re-asserted per-voice-turn but provably identical), or a minor
test-coverage asymmetry between web and mobile for a cosmetic Free-tier gate that is already airtight
server-side — none represent a regression or an unaddressed defect. No stale task-checkbox
reconciliation was needed — `tasks.md` already reflected true completion state.

## Deferred Follow-Ups (not blocking, tracked for future work)

1. **Real-device/Expo-simulator smoke for mobile voice** — mic capture, progressive token rendering
   during a live turn, Spanish-accented (ES) transcript handling, and `data:audio/mp3;base64,...`
   URI playback via `expo-audio` are all proven only via mocked unit/component tests; no
   device/simulator was available in the apply/verify environment. Recommend a manual device pass
   before or shortly after this ships to production mobile users, specifically covering: (a) the
   actual iOS/Android microphone permission dialog and capture, (b) a real Spanish-accented
   recording transcribed correctly, (c) audible mp3 playback actually produced, and (d) progressive
   UI updates during a genuinely slow network turn.
2. **No voice Playwright/e2e coverage** — no end-to-end test exercises the full web voice flow
   (push-to-talk → capture → transcribe → chat turn → TTS playback); the existing
   `create-plan-wizard.spec.ts` predates this change and doesn't exercise Asistente/voice at all.
   This mirrors the same accepted, deferred gap from item 12's own verify report.
3. **OD "Asistente de voz" ring/wave motion is statically styled** — `VoiceScreen.tsx`'s waveform
   (`styles.waveform`/`waveBar`/`waveBarActive`) has no `Animated`/motion logic; the pulsing/animated
   ring effect from the OD mockup is not implemented. Behaviorally correct (states transition
   Listo → Escuchando → Procesando → responde correctly) but visually static — a follow-up polish
   pass, not spec-blocking.
4. **No dedicated mobile-client Free-tier voice-gating test** — "Free sees no working voice
   affordance" has strong server-side enforcement (403 fail-closed on every voice call regardless of
   client UI state) but lacks a mobile-client-side cosmetic-gating regression test comparable to the
   web `CreatePlanShell.test.tsx` coverage. Low risk; a lightweight follow-up test would close the
   parity gap.
5. **Future STT/TTS abuse meter** — the spec explicitly scopes out any per-turn STT/TTS billing
   meter in this change (the Pro gate plus size/duration caps are the only controls); noted as a
   natural candidate for a future change if voice usage patterns show abuse.
6. **Periodic real-provider smoke test** — no recorded-fixture or staging-only test exercises the
   real `openai-audio-adapter` against actual Whisper/TTS endpoints; all current coverage uses an
   injected-fake OpenAI client. Recommended as an out-of-CI periodic check, mirroring the same
   suggestion made for item 12's LLM-quality gap.
7. **Dev/CI dependency-sync visibility** — the stale local `apps/mobile` `node_modules` (missing
   `expo-audio` until `pnpm install --frozen-lockfile` was re-run) suggests a `postinstall`/CI check
   that fails fast when a declared dependency is absent from `node_modules` would avoid this
   surfacing only at type-check time.
