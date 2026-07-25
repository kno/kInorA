# Archive Report: 12-v1.1-interactive-text-chat

## Status

- Artifact store: OpenSpec
- Task completion: 32/32 tasks complete across Phase 1–4 (`tasks.md`); no unchecked implementation tasks.
- Verification: `verify-report.md` — verdict PASS WITH WARNINGS. Build PASSED (`pnpm build`: deps-guard, ui-api-guard, architecture/depcruise, all workspace builds, `next build` with `/create-plan` and `/create-plan/chat` routes present). Both apps' `type-check` PASSED. `deps-guard` and `architecture` PASSED (confirms LLM/langchain code stays confined to `apps/api/src/ai/`, never leaks to web). Full test suite: 3519 passed / 0 failed / 53 skipped (pre-existing podman-gated integration tests, unrelated to this change). 8/8 requirements implemented; 22/26 scenarios fully COMPLIANT with direct runtime test coverage, 4/26 PARTIAL (none FAILING/blocking — each is an explicitly deferred or statically-evidenced gap, see Deferred Follow-ups below). 0 CRITICAL findings.
- Review: 4R adversarial review across the streaming/auth/LLM hot-path slices found 1 CRITICAL + 2 HIGH issues, all fixed pre-merge with RED→GREEN evidence in `tasks.md` (Phase 3 review-fix items):
  - **CRITICAL (fixed, S2b)**: a socket-level error during SSE writes could crash the process; `writeFrame`'s backpressure drain-wait now races `'drain'` against `'close'`/`'error'` on `raw` and `abort`, bails immediately if the signal is already aborted, and removes all listeners on settle — confirmed via a RED test proving the handler previously would not reach `finally`/`raw.end()` within the race window (task 3.9).
  - **HIGH (fixed, S2b)**: `PlanSpecExtractor.extract` did not honor an abort signal during Pass 2 — a wall-clock timeout or disconnect firing mid-extraction would block until the structured-output call resolved instead of cancelling it. Fixed by threading an optional `AbortSignal` through to `withStructuredOutput(...).invoke(input, { signal })` (task 3.8).
  - **HIGH (fixed, S3)**: an error-path UI glitch in `AssistantPane.tsx` could leave a blank assistant bubble and duplicate the user message on retry. Fixed via an `appendUserMessage` flag and `removeTrailingEmptyAssistant` guard, with a dedicated RED→GREEN test (task 4.8).
  - **WARNING (fixed, S2b)**: the route was not computing `missingFields` from the current draft for the extraction prompt, silently breaking the deterministic clarifying-question steering; fixed and tested (task 3.10).
  - **SUGGESTION (fixed, S2b)**: a misleading code comment in `app.ts` implying a silent Mock fallback in production was corrected (task 3.11).
  - **SUGGESTION (fixed, S3)**: `isSpecComplete` now also validates field ranges via `PlanSpecDraftSchema.safeParse`, not just presence, keeping "Generar plan" disabled for out-of-range panel edits (task 4.9).
  - A pre-push coverage-gate fix (task 4.10) raised global web function coverage from 88.88% to 91.37% (threshold 90%) by adding real behavioral tests, not coverage padding.
- Merge reference: PR #208 (Slice 1 — contracts/domain/extraction port), PR #209 (Slice 2a — SSE transport + Pro gate + fail-closed lifecycle), PR #210 (Slice 2b — structured extraction terminal event + masking, contains the CRITICAL/HIGH fixes above), PR #211 (Slice 3 — web Asistente UI + tier default + teaser + i18n), all merged to `main`.

## Source Artifacts Read

- `openspec/changes/12-v1.1-interactive-text-chat/proposal.md`
- `openspec/changes/12-v1.1-interactive-text-chat/exploration.md`
- `openspec/changes/12-v1.1-interactive-text-chat/design.md`
- `openspec/changes/12-v1.1-interactive-text-chat/tasks.md`
- `openspec/changes/12-v1.1-interactive-text-chat/verify-report.md`
- `openspec/changes/12-v1.1-interactive-text-chat/specs/12-v1.1-interactive-text-chat/spec.md` (delta)
- `openspec/specs/12-v1.1-interactive-text-chat/spec.md` (canonical scaffold, pre-merge)

## What Shipped

Interactive text chat for create-plan ("Asistente" mode): users describe fitness goals/constraints in natural language; per-turn LLM extraction maps free text into a validated `Partial<PlanSpec>` (the 6 wizard input fields + optional `name`, never `preferenceScores`/`confirmed`), merged into the SAME `plan_drafts` draft the 07 card wizard uses. The assistant's prose streams token-by-token over a new `POST /plan-specs/chat` SSE endpoint; the structured extraction result arrives as one terminal `draft` event, committed to the draft only at that point so a mid-stream failure never corrupts it. The feature is **Pro-gated and fail-closed** (tier resolved server-side from `authContext`/`resolveEffectiveTier`, never the request body) and is the **default create-plan mode for Pro tenants**; Free tenants see the Formulario wizard plus an Asistente teaser and "Mejora a Pro" CTA and cannot run chat turns regardless of client-side mode selection. Chat/extraction turns consume zero billing quota — only the pre-existing confirm → generate step consumes `plan_generation`, unchanged. Health/limitation text is masked before reaching the LLM/observability layer, and no raw transcript is embedded as vector memory.

### The 4 Slices and Their PRs

| Slice | PR | Scope |
|---|---|---|
| S1 | #208 | `PlanSpecDraftSchema` (contracts) + pure `mergePlanSpecDraft` domain fn + `PlanSpecExtractor` port/prompt/Mock in `apps/api/src/ai/`. No route, no web, no streaming, no billing change. |
| S2a | #209 | SSE transport (`reply.hijack()`/`reply.raw` + correct headers) + `ChatEntitlementPort` Pro gate (fail-closed, authContext-only) + abort/disconnect lifecycle. |
| S2b | #210 | LangChain `.stream()` prose (Pass 1) + terminal `withStructuredOutput` extraction (Pass 2) + masking + draft commit only on the terminal event. Contains the CRITICAL socket-error fix and the abort-signal-threading HIGH fix. |
| S3 | #211 | Tier-based default mode + Asistente SSE consumer (`fetch` + `ReadableStream`) + "Datos extraídos" per-field panel + mode toggle + Free teaser + `chat` i18n namespace (EN/ES parity). |

## Spec Sync

| Domain | Action | Details |
|---|---|---|
| `12-v1.1-interactive-text-chat` | Updated (canonical) | 2 modified requirements (Conversational Plan Definition — now field-allow-listed, enum/bounds-validated, fail-closed, with 6 scenarios up from 2; PlanSpec Edit Before Generation — now shared-draft-persisting with a generation-path constraint, 2 scenarios up from 1), 6 added requirements (Streaming Chat Endpoint (SSE), Shared Plan Draft Across Modes, Pro-Only Chat Gate (Fail-Closed), Tier-Based Default Mode and Free Teaser, Privacy and Data Protection, Chat Billing Boundary — 22 scenarios total across the 6 additions), 0 removed. The pre-existing "Chat History in Memory" requirement (4 scenarios) — not touched by this delta — is preserved unchanged. Purpose statement expanded to describe the Pro-gated Asistente mode, SSE streaming, and the shared draft. Delta's trailing Notes (denial-status decision, S2/S2a/S2b slice-split rationale, OD non-mapping-field scoping) preserved verbatim as canonical Notes, with the denial-status note resolved to the actual shipped decision (403, per design.md) and the slice-split note resolved to the actual shipped PRs. |

Final requirement count in the canonical spec: **8 requirements / 26 scenarios**, matching the verify-report compliance matrix exactly (Conversational Plan Definition 6, PlanSpec Edit Before Generation 2, Streaming Chat Endpoint (SSE) 4, Shared Plan Draft Across Modes 2, Pro-Only Chat Gate (Fail-Closed) 4, Tier-Based Default Mode and Free Teaser 3, Privacy and Data Protection 3, Chat Billing Boundary 2; the pre-existing Chat History in Memory requirement's 4 scenarios are additional and unaffected by this change).

## Warnings / Findings Preserved

- CRITICAL socket-error crash (S2b `writeFrame` backpressure race) and both HIGH issues (Pass-2 abort-signal not honored; error-path UI glitch duplicating user messages) were fixed pre-merge with RED→GREEN test evidence; none remain open.
- WARNING (missing-fields prompt steering) and both SUGGESTIONs (misleading comment; range-validation gap) were fixed pre-merge; none remain open.
- The pre-push coverage-gate WARNING (function coverage below the 90% threshold) was fixed with genuine behavioral tests (not coverage padding), raising coverage to 91.37%.
- verify-report's own residual WARNING/PARTIAL findings (none CRITICAL, none blocking) are carried forward as documented, intentionally-deferred follow-ups below.

## Archive Decision

Archive approved. Zero CRITICAL findings remain open — the one CRITICAL and two HIGH issues surfaced during review were fixed pre-merge with RED→GREEN evidence recorded directly in `tasks.md`'s Phase 3/4 review-fix items. All 32 implementation tasks are `[x]` and match the delivered code across PR #208–#211. Every required test/build/quality gate (contracts, domain, api, web, i18n suites; both apps' type-check; deps-guard; architecture; full `pnpm build`) passes with 0 failures across 3519 executed tests. The 4 PARTIAL spec-compliance scenarios are each either explicitly deferred in the design/tasks artifacts themselves or backed by strong static/structural evidence rather than a dedicated runtime test — none represent a regression or an unaddressed defect. No stale task-checkbox reconciliation was needed — `tasks.md` already reflected true completion state.

## Deferred Follow-Ups (not blocking, tracked for future work)

1. **Chat Playwright/e2e coverage** — no end-to-end test exercises the full Asistente flow (send message → stream → panel populate → generate). The existing `create-plan-wizard.spec.ts` e2e explicitly switches to Formulario mode to route around the new Asistente default. Design's own testing-strategy table marked this "(later) — deferred" from the start.
2. **Offline-reconnect test** — only the manual retry-after-error UX (button click) is tested; no test simulates an actual `navigator.onLine` connectivity-loss/restore transition for automatic reconnect.
3. **Runtime no-quota assertion** — "chat turn consumes no billing quota" is currently proven only structurally (no quota-consuming port/method exists on the route's test double), not via a dedicated runtime spy/regression test. Recommended: add a lightweight test asserting a quota-consumption mock is never invoked during a chat turn, to lock this in against future refactors.
4. **Concurrent-turn lost-update server guard** — a fast double-submit across two tabs/devices for the same tenant+user can still race at `upsertDraft`; currently mitigated only by a client-side `streaming` guard within a single tab, explicitly flagged as `TODO(S3)` in `plan.ts`. Low likelihood/low blast radius (a lost single-field update, not data corruption or a security issue) but worth a server-side lock in a future change.
5. **Equipment/limitations per-item editing** — not called out as a blocking gap in verify, but the "Datos extraídos" panel's per-field review model for array-valued fields (equipment, limitations) may warrant a UX follow-up for finer-grained (per-item, not whole-array) editing.
6. **Two-pass prose/extraction disagreement** — Pass 1 (streamed prose) and Pass 2 (structured extraction) are independent LLM calls that MAY disagree; this is documented as an accepted, disclosed limitation (the committed draft always uses Pass 2's output) rather than a defect, but remains a candidate for a future single-pass or reconciliation improvement.
