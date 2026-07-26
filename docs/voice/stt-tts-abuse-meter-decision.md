# Decision: defer the STT/TTS abuse meter (voice), item-13 follow-up #231

**Status:** Accepted — v1 ships with NO per-turn STT/TTS meter.
**Date:** 2026-07-26
**Scope:** Voice input (speech-to-text, `POST /plan-specs/transcribe`) and voice
output (text-to-speech, `POST /plan-specs/speech`) on web and mobile.

## Decision

Voice does **not** get its own usage meter or per-turn billing counter in v1.
The existing controls are sufficient:

- **Pro gate.** Both `/plan-specs/transcribe` and `/plan-specs/speech` are
  Pro-only; a Free tenant is refused server-side with `403`. Voice is therefore
  unavailable to the unentitled tier entirely — there is no free volume to abuse.
- **Size / format caps.** Transcribe enforces server-side audio size and format
  limits, bounding the cost of any single request.
- **Zero billing units on the voice path.** A voice turn (transcribe → chat →
  speak) consumes **no** `plan_generation` unit. The only metered call remains
  the unchanged confirm→generate gate (`POST /plan-specs/:id/confirm`), reached
  from the create-plan confirm flow, never from the voice loop. This boundary is
  pinned by `apps/mobile/src/api/__tests__/voice-billing-boundary.test.ts` and
  the equivalent web coverage.

Because voice is gated to paying tenants, bounded per request, and outside the
generation meter, a dedicated abuse meter would add billing/quota complexity
with no v1 risk to offset it.

## Client UX note (implemented alongside this decision)

The Free-tier `403` is airtight server-side. The client now surfaces it clearly
instead of masking it as a generic retry error: `transcribe-client.ts` maps a
`403` to `{ kind: "error", status: 403, premiumRequired: true }`, and the mobile
`VoiceScreen` shows an upgrade notice (`voice.premium`) rather than
`voice.error`. See `apps/mobile/src/screens/voice/__tests__/VoiceScreen.test.tsx`
("#231 Free-tier Pro gate surfaced client-side").

## Revisit triggers

Introduce a per-turn STT/TTS meter (or rate limit) if, in production, we observe:

1. **Abnormal per-tenant STT/TTS volume** — a Pro tenant driving voice requests
   far beyond normal interactive use (e.g. scripted/automated hammering).
2. **STT/TTS becoming a material cost line** — provider spend on transcription /
   synthesis growing to a level where per-turn accounting is worth its
   complexity.
3. **Abuse patterns the size caps don't bound** — e.g. high-frequency small
   requests, or synthesis of very long replies, that slip under per-request
   limits but add up.

Until one of these is observed, **do not build the meter.**
