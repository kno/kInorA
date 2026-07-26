# Archive Report: 14a-v1.1-adaptation-adherence

## Status

- Artifact store: Hybrid (OpenSpec filesystem + Engram)
- Task completion: 40/40 tasks complete across 8 slices / 4 tracks (`tasks.md`); no unchecked implementation tasks.
- Verification: `verify-report.md` — verdict PASS WITH WARNINGS. Build PASSED (`pnpm build`: packages/i18n, packages/contracts, packages/domain, apps/api all built; `apps/web` `next build` compiled successfully with the `/dashboard` route present). All three apps' `type-check` PASSED independently (api/web/mobile). `deps-guard` and `architecture` PASSED across all 6 workspaces (confirms the domain function and web/mobile stay free of AI/DB imports). Full test suite: 3176 passed / 0 failed / 53 skipped (pre-existing podman-gated integration tests, unrelated to this change). Web coverage 94.86% stmts / 86.81% branch / 91.18% funcs / 94.86% lines — above the ≥90% function-coverage threshold. 11/11 requirements implemented; 27/27 scenarios fully COMPLIANT (0 PARTIAL, 0 FAILING/UNTESTED). 0 CRITICAL findings in the final verify pass.
- Review: adversarial 4R review on B1 (the new authenticated `POST /plan-specs/:id/adapt` confirm route mutating a plan spec and consuming billing quota — treated as high-risk regardless of line count) surfaced 1 CRITICAL — the route's default idempotency key was a stable `plan_regeneration:adapt:${id}` that would let a repeated accept during the async generation window replay the ledger for a free extra regeneration. Fixed pre-merge: the key is now a fresh `${...}:${randomUUID()}` nonce per request (mirroring `/regenerate`'s existing default), with a caller-supplied `Idempotency-Key` header still honored for genuine retries. Review also surfaced several WARNINGs, all fixed pre-merge: `DashboardCoachCard`'s accept/dismiss buttons now disable while in flight (closes a rapid-double-click double-POST window); the mobile `PlanStatusScreen` poll loop gained a consecutive-error threshold (tolerates one transient blip, then surfaces an error state instead of spinning forever) and a poll-attempt cap with a "taking longer than expected" stalled state + manual refresh (closes an infinite-poll-on-dead-backend gap), mirroring the mic-lifecycle-style resilience fixes established in item 13's voice-chat review. The final verify pass found 0 CRITICAL findings remaining open.
- Merge reference: PR #235 (A1 — pure `computeAdherenceAdaptation` + shared type-only `AdaptationRecommendation` contract), PR #236 (A2 — fold recommendation into `getDashboardSummary`/`DashboardSummaryDTO`, no quota), PR #237 (B1 — `POST /plan-specs/:id/adapt` server-authoritative confirm route + `DashboardCoachCard` banner), PR #238 (B2 — web `adaptation` i18n EN/ES + loading/error/exhausted states), PR #239 (C1 — mobile `plan-status-client.ts` port/regenerate/adapt client), PR #240 (C2 — mobile `PlanStatusScreen` generating/ready/failed states), PR #241 (C3 — mobile `HomeScreen` nav entry + dashboard-summary fetch, replacing the manual `workoutPlanId` paste), PR #242 (D1 — mobile `AdherenceBanner` + confirm via the Track C client) — all merged to `main`.

## Source Artifacts Read

- `openspec/changes/14a-v1.1-adaptation-adherence/proposal.md` (Engram `sdd/14a-v1.1-adaptation-adherence/proposal`, obs #2414)
- `openspec/changes/14a-v1.1-adaptation-adherence/exploration.md` (Engram `sdd/14a-v1.1-adaptation-adherence/explore`, obs #2413)
- `openspec/changes/14a-v1.1-adaptation-adherence/design.md` (Engram `sdd/14a-v1.1-adaptation-adherence/design`, obs #2416)
- `openspec/changes/14a-v1.1-adaptation-adherence/tasks.md` (Engram `sdd/14a-v1.1-adaptation-adherence/tasks`, obs #2417)
- `openspec/changes/14a-v1.1-adaptation-adherence/verify-report.md` (Engram `sdd/14a-v1.1-adaptation-adherence/verify-report`, obs #2419)
- `openspec/changes/14a-v1.1-adaptation-adherence/specs/14a-v1.1-adaptation-adherence/spec.md` (delta, MODIFIED 3 requirements / ADDED 8 requirements — Engram `sdd/14a-v1.1-adaptation-adherence/spec`, obs #2415)
- `openspec/specs/14a-v1.1-adaptation-adherence/spec.md` (canonical scaffold, pre-merge — 3 thin placeholder requirements: Adherence Tracking, Adherence-Based Recommendation, User Confirmation)
- Also read for context (not re-archived, referenced only): Engram `sdd/14a-v1.1-adaptation-adherence/apply-progress`, obs #2418

## What Shipped

A **deterministic, adherence-based plan-adaptation surface** on top of items 09b/09c (offline history +
progress dashboard) and 07/08 (plan model + AI generation), delivered on **both web and mobile**. The
system observes whether a user is completing their planned training frequency over a **configurable
rolling window** (default 4 weeks) and, when adherence drops below **70%**, computes a deterministic
**suggestion** to reduce weekly frequency by one day (floored at 1 day/week) — never an LLM decision,
never auto-applied. The recommendation rides on the **shared `AdaptationRecommendation` contract**
(`packages/contracts`) with a `source` discriminator (`'adherence'` populated now; `'rpe'` reserved for
the sibling item 14b), so both signals can compose into **one** dashboard banner slot instead of two
competing ones. The recommendation is folded into the **already-fetched** `GET /progress/dashboard` read
— zero extra DB round-trip, zero billing quota consumed, available to all tiers. Confirmation is
**suggest-and-accept**: a new server-authoritative `POST /plan-specs/:id/adapt` route re-derives the
reduced frequency itself (never trusting the client body), persists it, gates on the existing
`plan_regeneration` billing unit (consume-before-write), and regenerates through the **proven, unchanged**
`startGeneration` pipeline. Rejecting leaves the plan untouched and consumes nothing. The deliberate
"no missed state" decision from 09c is preserved — `WeeklyDayStatus` gains no new value; adherence is
strictly a separate banner/percentage.

Because `apps/mobile` (Expo RN) had **no plan-view/regenerate surface at all** before this change, mobile
confirmation required first porting that flow to React Native (Track C) — a plan-status + regenerate/adapt
client, a generating/ready/failed screen, and a Home-screen nav entry + dashboard-summary fetch replacing
the prior manual `workoutPlanId`-paste flow — before the mobile adherence banner (Track D) could confirm
anything. This mirrors the same foundation-before-feature pattern item 13 (voice chat) established for
mobile.

### The 4 Tracks and Their 8 Slices/PRs

| Track | Slice | PR | Scope |
|---|---|---|---|
| A — Domain + shared API | A1 | #235 | Pure `computeAdherenceAdaptation` (rolling window, `<70%` threshold, `max(1, fromDays-1)` floor, insufficient-data guards) + shared type-only `AdaptationRecommendation`/`AdherenceSnapshot`/`SuggestedChange` contract. No HTTP, no UI, no billing. |
| A — Domain + shared API | A2 | #236 | Fold the recommendation into `getDashboardSummary`/`DashboardSummaryDTO` via `GET /progress/dashboard`. Read-only, tenant/user-scoped, zero quota, zero new DB query. |
| B — Web | B1 | #237 | `POST /plan-specs/:id/adapt` (server-authoritative re-derivation, consume-before-write `plan_regeneration` gate, `startGeneration`) + `updateSpecDaysPerWeek` repo method + `DashboardCoachCard` real adherence banner (accept/reject). |
| B — Web | B2 | #238 | `adaptation` i18n namespace (EN/ES parity, 9 keys) + loading/insufficient/ok/error/quota-exhausted states wired into `DashboardCoachCard`. |
| C — Mobile foundation | C1 | #239 | `apps/mobile/src/api/plan-status-client.ts` — `fetchPlanStatus` + `adaptPlan` + `regeneratePlan` + `fetchDashboardSummary`, mirroring the existing `plan-draft-client.ts` SecureStore Bearer pattern. No new backend routes. |
| C — Mobile foundation | C2 | #240 | `apps/mobile/src/screens/plan/PlanStatusScreen.tsx` (generating/ready/failed states, poll loop with error-threshold + attempt-cap resilience fixes, Regenerate action). |
| C — Mobile foundation | C3 | #241 | `HomeScreen.tsx` rewritten — dashboard-summary fetch via the C1 client, navigation entry to `PlanStatus`, removal of the manual `workoutPlanId` text-input flow. |
| D — Mobile voice | D1 | #242 | `apps/mobile/src/screens/AdherenceBanner.tsx` — mobile adherence banner consuming the C3 dashboard read, confirm via the C1 `adaptPlan` client, double-tap guard, `sessionExpired` handling; reuses the shipped `adaptation` i18n namespace with no mobile-only copy fork. |

Merge order confirms the designed sequencing: A1 → A2 → B1 → B2 (web ships complete and independently) →
C1 → C2 → C3 → D1 (Track C, the long pole, completed before Track D began), exactly as `design.md`'s
Slice Boundaries section specified.

## Spec Sync

| Domain | Action | Details |
|---|---|---|
| `14a-v1.1-adaptation-adherence` | Updated (canonical) | The 3 thin placeholder requirements from the pre-merge scaffold (Adherence Tracking, Adherence-Based Recommendation, User Confirmation — 3 scenarios total) were superseded and replaced by the delta's 11 concrete, precisely-specified requirements: **MODIFIED** Adherence Tracking (5 scenarios: low-adherence detected, at-or-above-threshold ok, no-active-plan insufficient-data, zero-planned-sessions insufficient-data, new-user-under-one-window insufficient-data), Adherence-Based Recommendation (2: frequency-reduction triggered, floored at minimum), User Confirmation (4: user rejects, user accepts, exhausted-quota fails safely, no-auto-apply-path); **ADDED** Shared Adaptation Recommendation Contract (2), On-Demand Read Surface (2), Frequency-Only Adjustment in Slice 1 (1), Preserve the No-Missed Day State (1), Web Adherence Suggestion Surface (4), Mobile Adherence Suggestion Surface (2), Coaching Tone and Internationalization (1), Boundaries and Security (2) — 27 scenarios total, matching the verify-report compliance matrix exactly. Purpose statement rewritten to describe the deterministic adherence-based adaptation (suggest-and-confirm frequency reduction reusing the plan_regeneration path) delivered on web + mobile, the shared `AdaptationRecommendation` contract designed for 14b (RPE) to later compose into, and the "no missed state" preservation. Delta's trailing design-decision Notes (window default, read-surface shape, quota-exhausted status, mobile sequencing) preserved as canonical Notes, each resolved from "(design decision)" placeholders to the actual shipped decisions per `design.md`/`verify-report.md` (periodWeeks default 4 pinned in code; `toDays = max(1, fromDays-1)` floor; folded into `DashboardSummaryDTO`/`GET /progress/dashboard`, not a dedicated endpoint; new `POST /plan-specs/:id/adapt` route with `409 no_adaptation` on stale/forged accepts, `403` on quota-exhausted, fresh-nonce idempotency key per accept; mobile Track D depended on Track C's three slices). |

Final requirement count in the canonical spec: **11 requirements / 27 scenarios**, matching the
verify-report compliance matrix exactly (Adherence Tracking 5, Adherence-Based Recommendation 2, User
Confirmation 4, Shared Adaptation Recommendation Contract 2, On-Demand Read Surface 2, Frequency-Only
Adjustment in Slice 1 1, Preserve the No-Missed Day State 1, Web Adherence Suggestion Surface 4, Mobile
Adherence Suggestion Surface 2, Coaching Tone and Internationalization 1, Boundaries and Security 2).

## Warnings / Findings Preserved

- The CRITICAL (stable idempotency key on `/adapt` allowing a free-regeneration replay during the async
  generation window) was fixed pre-merge — a fresh nonce per accept, mirroring `/regenerate`'s existing
  default, with header override still honored for genuine client retries. Confirmed by two dedicated
  tests (`plan-adapt.test.ts` — distinct accepts consume two separate units; a second accept in the same
  period is denied 403 with no extra generation). None remain open in the final verify pass.
- The double-click/double-POST (web) and poll-loop-never-terminates (mobile) WARNINGs were fixed pre-merge
  with RED→GREEN test evidence recorded in `tasks.md` items 3.8 and 6.6.
- verify-report's own residual WARNING/PARTIAL findings (none CRITICAL, none blocking) are carried
  forward as documented, intentionally-deferred follow-ups below.

## Archive Decision

Archive approved. Zero CRITICAL findings remain open in the final verify pass — the one CRITICAL
(idempotency-key quota-amplification on `/adapt`) surfaced during adversarial review on the high-risk B1
slice was fixed pre-merge with RED→GREEN test evidence recorded in `tasks.md`'s apply-progress notes
(item 3.8), along with the double-click and poll-loop resilience WARNINGs (item 6.6). All 40 implementation
tasks are `[x]` and match the delivered code across PR #235–#242. Every required test/build/quality gate
(domain, contracts, api, web, mobile, i18n suites; all three apps' type-checks; deps-guard; architecture;
full `pnpm build`; web coverage 94.86% funcs, above the 90% threshold) passes with 0 failures across 3176
executed tests (53 pre-existing podman-gated integration tests skipped, unrelated to this change). All 27
spec-compliance scenarios are fully COMPLIANT (0 PARTIAL, 0 FAILING/UNTESTED) — none represent a regression
or an unaddressed defect. No stale task-checkbox reconciliation was needed — `tasks.md` already reflected
true completion state.

## Deferred Follow-Ups (not blocking, tracked for future work)

1. **Write↔`startGeneration` non-atomicity** — `POST /plan-specs/:id/adapt` persists the reduced
   `daysPerWeek` and THEN calls `startGeneration`; a synchronous failure between those two steps (after
   quota was consumed) surfaces as a non-202 error (confirmed by a regression test — never a silent
   success) but leaves the spec with the reduced frequency persisted and no plan yet regenerated at that
   frequency. This is the same pre-existing non-atomicity pattern the `/regenerate` route already carries
   (write-then-generate, no wrapping transaction). Self-healing (retry-friendly) and explicitly reviewed —
   not spec-blocking. Recommend a lightweight DB-transaction wrapper or compensating-action pass around
   both `/adapt` and `/regenerate`/`/confirm` if this window needs to be fully closed.
2. **No mobile Expo dev-client/device smoke test** — `PlanStatusScreen`, `HomeScreen`, and
   `AdherenceBanner` are proven only via injected-fetch/mocked-navigation component tests; no
   device/simulator was available in the apply/verify environment. Mirrors the same accepted, deferred
   gap noted in item 13's voice-chat verify report. Recommend a manual device pass before or shortly after
   this ships to production mobile users.
3. **No web Playwright/e2e coverage of the adherence-suggestion flow** — no end-to-end test exercises
   dashboard load → banner render → accept → regenerate → plan updated. The existing e2e suite predates
   this change. Mirrors the same accepted, deferred gap from items 12 and 13's verify reports.
4. **No i18n pluralization variant for day counts** — the `adaptation` namespace's `suggestion` copy has
   no distinct "1 day/week" vs "N days/week" phrasing; low risk since `toDays` is floored at 1 and
   `suggestedChange` is omitted at that floor, but the `fromDays` side of the interpolated string should
   be spot-checked for EN/ES grammatical correctness if it ever renders "1 day/week".
5. **No regression test locking `SuggestedChange.kind` to a single variant** — nothing today prevents a
   future change from accidentally introducing a second `kind` into the discriminated union; a dedicated
   type-level/runtime test would make the "Frequency-Only Adjustment in Slice 1" scope boundary
   self-enforcing as item 14b (RPE) is developed alongside the shared contract.
6. **Item 14b (RPE)** — the shared `AdaptationRecommendation` contract's `source: 'rpe'` branch is
   reserved but unpopulated; the RPE/perceived-intensity signal computation itself is out of scope for
   14a and is the subject of the sibling roadmap item.
