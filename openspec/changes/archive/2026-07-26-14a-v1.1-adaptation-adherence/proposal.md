# Proposal: 14a — v1.1 Adaptation from Adherence

## Intent

Stop leaving users on a stale plan they are not actually completing. Observe whether
a user is keeping up with their planned training frequency and, when adherence drops
below a threshold over a rolling window, **suggest** a lower-frequency plan (e.g. 4 → 3
days/week) that the user can accept or reject. Accepting materializes the adjusted plan
through the **existing** regenerate → generate path (08); rejecting leaves the current
plan untouched.

This is the first of the v1.1 "dynamic plan adaptation" pair (14b = RPE/perceived
intensity). 14a is **adherence only**. It is not a new AI brain: the adherence signal
already exists (09c) and the plan-change mechanism already exists (regenerate). 14a wires
adherence signal → **deterministic** recommendation → the existing user-confirmed
plan-change path. The recommendation is computed on-demand at dashboard read (no scheduler
infra exists), from data the dashboard already fetches.

The canonical spec mandates the shape: compare completed vs planned over a **configurable
period**; SHOULD suggest lower frequency/volume below **70%** adherence (scenario: 31% →
suggest 4 → 3 days); and adherence-based changes MUST be **suggestions requiring user
confirmation** — auto-apply is spec-forbidden.

## Target Users

- **All tiers.** Any user with an active ready plan and enough completion history sees the
  adherence recommendation. The recommendation itself is **not Pro-gated** — it is a cheap,
  deterministic read that consumes no billing quota.
- Users falling behind their plan who would otherwise silently abandon it — the suggestion
  is a coaching nudge, framed as an option, never a diagnosis.
- **Web users first surface**, then **mobile users** — but mobile has **no plan-view /
  regenerate surface today**, so mobile confirmation requires porting that flow to React
  Native first (see Track C). Both platforms are in scope for this change; mobile is
  sequenced behind its prerequisite.
- **Free tenants:** confirming an adaptation consumes their single monthly
  `plan_regeneration` unit — but **only on explicit confirm**, never automatically. The
  recommendation costs nothing.

## Scope

### In Scope

- **Deterministic domain policy (not an LLM).** A new pure function
  `computeAdherenceAdaptation` beside `computeAdherence` in
  `packages/domain/src/progress/`. Input: `{ completedAtDates, plannedSessionsPerWeek,
  periodWeeks }`; output: an adherence percentage, a level, and an optional
  recommendation. Threshold `< 70%` → suggest a frequency reduction; the `31% → 4 → 3`
  scenario is a direct unit test. Pure, cheap, no I/O, no LLM. The LLM is used **only** to
  materialize the adjusted plan, through the existing regenerate path — no new LLM call
  type is introduced.
- **Configurable period = rolling window (recommend 4 weeks).** Adherence % =
  `completedInWindow / (plannedSessionsPerWeek * periodWeeks)`, computed from the
  already-fetched 60-session history + latest ready plan. Below `< 70%` suggests reducing
  frequency by one day/week (floored at a sane minimum). **Frequency reduction only in
  slice 1**; volume/de-load is deferred.
- **Shared `AdaptationRecommendation` contract (in `packages/contracts`).** A single
  recommendation shape that 14a (adherence) populates now and 14b (RPE) will populate later,
  so both compose into **one** dashboard surface rather than two competing banners. Carries
  the signal source, the suggested change, and the human-facing rationale keys. Sketch
  below.
- **Suggest-and-confirm (spec MUST).** The recommendation is surfaced as a banner. **Accept**
  → adjust the PlanSpec's `daysPerWeek` and call the existing
  `POST /plan-specs/:id/regenerate` (consuming `plan_regeneration`). **Reject** → the plan is
  unchanged and nothing is consumed. Auto-apply is forbidden.
- **On-demand at dashboard read.** The recommendation is recomputed each time the dashboard
  summary is read — either folded into `DashboardSummaryDTO` (the summary already loads the
  60-session history + latest ready plan) or exposed via a small tenant/user-scoped
  `GET /adaptation/adherence`. No scheduler, no cron, no background jobs, no event queue.
- **Quota model.** Confirming an adaptation consumes the existing `plan_regeneration` unit
  (Free = 1/month) via the current regenerate path. The recommendation read consumes
  **nothing** and is available to all tiers. Quota is spent **only** on explicit user confirm.
- **Insufficient-data handling → no recommendation.** No active ready plan,
  `plannedSessionsPerWeek = 0`, or less than one full period of history (new users) →
  the domain function returns `level: 'insufficient_data'` and **no recommendation**. The
  60-session window truncation is handled explicitly.
- **Reconcile with the deliberate "no missed state".** `WeeklyOverviewDTO` /
  `WeeklyDayStatus` intentionally has **no "missed" state** (`"done" | "active" | "rest" |
  "soon"`). 14a does **not** add one. Adherence is represented as a **separate percentage /
  banner**, never as a new day-grid status. The week board is left untouched.
- **Web surface (Track B).** Suggestion banner on `DashboardCoachCard` with accept → regenerate
  (reduced days) / reject → unchanged, reusing the existing `regeneratePlan` client. New
  `adaptation` i18n namespace (EN/ES parity) with empty / insufficient-data / error states.
- **Mobile plan/regenerate foundation (Track C — prerequisite, large).** `apps/mobile` (Expo
  RN) has HomeScreen + tracker/history but **no create-plan / plan-view / regenerate surface
  at all**. Confirming an adaptation on mobile is impossible until that flow is ported to RN
  (analogous to item 13's Track C). This is the **bulk of the mobile effort** and may span
  multiple slices.
- **Mobile surface (Track D).** The adherence suggestion banner on the mobile Home /
  dashboard, with confirm wired to the RN regenerate flow delivered by Track C.
- **Hexagonal + tenant discipline.** Policy is a pure domain function (no I/O); the API
  aggregates and the route orchestrates; web/mobile render only. LLM stays confined to
  `apps/api/src/ai`. Every read is tenant + user scoped from `authContext`.

### Out of Scope (non-goals)

- **LLM-based adaptation logic.** The recommendation is deterministic domain code. The LLM
  is used only to render the adjusted plan through the existing regenerate → generate path.
- **Auto-apply / silent regeneration.** Spec-forbidden. A plan never changes without an
  explicit user confirm.
- **Scheduled / cron / background sweeps.** No scheduler infra exists; none is introduced.
  Recommendation is computed on-demand at read time only.
- **Volume reduction / de-load beyond frequency.** Slice 1 adjusts `daysPerWeek` only.
  Volume, per-session de-load, and intensity tuning are deferred to a later slice/change.
- **A "missed" `WeeklyDayStatus`.** The deliberate "no missed state" model is preserved;
  adherence is a separate banner/percentage, not a day-grid state.
- **A separate adaptation quota meter.** No new billing unit. Confirm reuses the existing
  `plan_regeneration` gate; the recommendation read is free.
- **In-place plan mutation / new plan-edit primitive.** `workout_plans` rows are write-once;
  adapting means adjusting `PlanSpec.daysPerWeek` + regenerating. No new schema or edit path.
- **14b RPE signal logic.** Only the **shared contract** is defined here so 14b slots in
  later; the RPE computation itself is item 14b.

## Approach

- **Reuse, don't duplicate.** The adherence data (`computeAdherence`), the dashboard
  aggregation (`getDashboardSummary`: 60-session history + latest ready plan +
  `plannedSessionsPerWeek`), the regenerate path (`POST /plan-specs/:id/regenerate` →
  adjusted `PlanSpec` → `startGeneration`), the billing gate (`plan_regeneration`), and the
  web regenerate client (`regeneratePlan`) all already exist and ship unchanged. 14a adds
  exactly: one pure domain function, one recommendation contract, one read surface, and one
  banner per platform.
- **Deterministic policy in domain.** `computeAdherenceAdaptation` lives beside
  `computeAdherence`, pure and unit-tested. Threshold and window are parameters
  (`periodWeeks` default 4, threshold `< 70%`), so "configurable period" is satisfied without
  new infra. It emits an `AdaptationRecommendation` or nothing.
- **Shared recommendation contract now, so 14b composes.** Define `AdaptationRecommendation`
  in `packages/contracts` with a `source` discriminator (`"adherence"` now, `"rpe"` later) and
  a `suggestedChange` (`reduce_frequency` with `fromDays` / `toDays`). Both 14a and 14b feed
  the same dashboard banner slot — never two competing banners.
- **Suggest → confirm → existing regenerate.** Accept adjusts `PlanSpec.daysPerWeek` to
  `toDays` and calls the existing regenerate endpoint, which consumes `plan_regeneration` and
  runs the proven generation pipeline. Reject is a pure no-op. The MUST-confirm constraint is
  structurally enforced: there is no code path that regenerates without a user action.
- **Web-first, mobile-sequenced.** Web is low-blast-radius because the API is shared and the
  plan/regenerate surface already exists. Mobile requires porting that surface (Track C) before
  the banner (Track D) can confirm anything — so mobile is explicitly sequenced after its
  prerequisite and flagged as the largest mobile cost.
- **Coaching tone, never a diagnosis.** All copy lives in the `adaptation` i18n namespace and
  is framed as an optional suggestion ("Want to try 3 days/week?"), never a judgment about the
  user.

### `AdaptationRecommendation` contract sketch

```ts
/**
 * Shared "adaptation recommendation" contract. 14a (adherence) populates it now;
 * 14b (RPE) will populate the same shape later so both compose into ONE dashboard
 * banner slot instead of two competing banners. Purely advisory — never auto-applied.
 */
export type AdaptationSignalSource = "adherence" | "rpe"; // "rpe" reserved for 14b

export interface AdherenceSnapshot {
  /** 0..1 completed vs planned over the rolling window. */
  adherence: number;
  /** Rolling window length in weeks used for the computation (default 4). */
  periodWeeks: number;
  completedInWindow: number;
  plannedInWindow: number;
}

export type AdaptationLevel = "ok" | "low" | "insufficient_data";

export type SuggestedChange = {
  kind: "reduce_frequency";
  fromDays: number; // current PlanSpec.daysPerWeek
  toDays: number;   // suggested reduced frequency (>= sane minimum)
};

export interface AdaptationRecommendation {
  source: AdaptationSignalSource;
  level: AdaptationLevel;
  /** Present only when level === "low" and a change is worth suggesting. */
  suggestedChange?: SuggestedChange;
  /** i18n message key(s) for the coaching rationale — never raw prose. */
  rationaleKey?: string;
  /** The spec id to regenerate on confirm (adjusted daysPerWeek). */
  planSpecId?: string;
  /** Signal-specific context (adherence snapshot for 14a). */
  adherence?: AdherenceSnapshot;
}
```

The domain output for 14a is `{ level, suggestedChange?, adherence }`; the API layer attaches
`planSpecId` and `rationaleKey`. When `level` is `ok` or `insufficient_data`, no banner renders.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/contracts/src/index.ts` | New | `AdaptationRecommendation` + `AdherenceSnapshot` + `SuggestedChange` (shared with 14b) |
| `packages/domain/src/progress/` | New | pure `computeAdherenceAdaptation` beside `computeAdherence` (rolling window, `< 70%`, 4 → 3, insufficient-data) |
| `apps/api/src/db/repositories/workout-session.ts` | Modified | attach the recommendation to the dashboard summary read (reuse the already-fetched history + plan) |
| `apps/api/src/routes/` | Modified/New | expose recommendation on the dashboard-summary read (or small `GET /adaptation/adherence`), tenant/user scoped, no quota |
| `apps/api/src/billing/plan-limits.ts` | Reused | confirm reuses `plan_regeneration` via the existing regenerate path — unchanged |
| `apps/web` dashboard | Modified | suggestion banner on `DashboardCoachCard`; accept → `regeneratePlan(reduced days)` / reject → unchanged |
| `apps/mobile` (Expo RN) | New (large) | Track C: port plan view + regenerate flow to RN (none today). Track D: adherence banner + confirm via RN regenerate |
| `packages/i18n/src/messages/{en,es}.json` | Modified | new `adaptation` namespace (EN/ES parity) + empty/insufficient/error copy |

## Slicing (chained PRs, ~one session each, ≤~200 authored lines, TDD-able)

### Track A — domain + shared API (shared, foundational)

1. **A1 — pure policy + shared contract (no route, no UI).** `AdaptationRecommendation` +
   `AdherenceSnapshot` + `SuggestedChange` in `packages/contracts`; pure
   `computeAdherenceAdaptation` in `packages/domain/src/progress/` (rolling window default 4
   weeks, `< 70%` threshold, `31% → 4 → 3` scenario, floor on `toDays`, insufficient-data →
   no recommendation). Fully unit-tested. **Boundary: no HTTP, no UI, no billing change.**
2. **A2 — surface on the read (no quota).** Attach the recommendation to the dashboard-summary
   read (fold into `DashboardSummaryDTO` or a small tenant/user-scoped `GET /adaptation/adherence`),
   computed from the already-fetched 60-session history + latest ready plan. **Boundary: read-only,
   consumes nothing; confirm still flows only through the existing regenerate endpoint.**

### Track B — web (depends on A)

3. **B1 — web suggestion banner + confirm.** Suggestion banner on `DashboardCoachCard`;
   accept → adjust `daysPerWeek` and call the existing `regeneratePlan` (consumes
   `plan_regeneration`); reject → plan unchanged. **Boundary: reuse `regeneratePlan`; no new
   generation entry point; MUST-confirm enforced (no auto path).**
4. **B2 — web i18n + empty/error states.** `adaptation` i18n namespace (EN/ES parity);
   insufficient-data / no-recommendation / regenerate-error / coaching-tone copy. **Boundary:
   copy + state rendering only.**

### Track C — mobile plan/regenerate foundation (PREREQUISITE, large)

5. **C1..Cn — port plan view + regenerate to RN.** `apps/mobile` has **no** plan-view or
   regenerate surface today; this ports it to React Native (analogous to item 13's Track C).
   **This is the bulk of the mobile effort and will very likely span multiple slices** (plan
   fetch/status view, then the regenerate action + generating/ready states). Sequenced before
   Track D. **Boundary: reuse the shared API; no new endpoints; parity with the web
   plan/regenerate behavior.**

### Track D — mobile adherence surface (depends on A + C)

6. **D1 — mobile suggestion banner + confirm.** Adherence banner on the mobile Home /
   dashboard; confirm wired to the RN regenerate flow from Track C; reuse the `adaptation`
   i18n namespace. **Boundary: render + confirm via the Track C regenerate; same MUST-confirm
   and no-quota-on-read rules as web.**

**Rough relative effort:** A (small–med, foundational) < B (small–med, two thin web slices)
≪ **C (large, multi-slice RN port — dominates the whole change)** < D (small, once C exists).
Track C is the long pole; A + B deliver the full behavior on web independently of it.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Silent quota burn — an auto-regenerate spends the Free user's single monthly `plan_regeneration` | High | **Suggest-and-confirm only.** The recommendation read consumes nothing; `plan_regeneration` is spent **only** on explicit user confirm through the existing regenerate path. No auto path exists in code. |
| Contract conflict with the deliberate "no missed state" | Med | Adherence is a **separate percentage / banner**, never a new `WeeklyDayStatus`. The week board is untouched; `WeeklyDayStatus` stays `"done" \| "active" \| "rest" \| "soon"`. |
| No scheduler infra → temptation to build one | Med | On-demand at dashboard read only, from data already fetched. No cron/queue/background job introduced. |
| Insufficient-history edge cases (no ready plan, `plannedSessionsPerWeek = 0`, < 1 period, 60-session truncation) | Med | Domain function returns `insufficient_data` → **no recommendation**; each edge case is a unit test. |
| Coaching tone drifts into diagnosis | Med | All copy in the `adaptation` i18n namespace, framed as an optional suggestion; reviewed EN/ES; never a judgment about the user. |
| Mobile confirmation impossible without the RN plan/regenerate surface | High | Explicitly sequence **Track C (port) before Track D (banner)**; flag C as multi-slice and the bulk of the mobile cost; web (A + B) ships independently. |
| Recommendation churn (flips low→ok week to week) | Low | Deterministic rolling window smooths short-term noise; suggestion is dismissible and re-evaluated at read. |
| 14b later competes for the same UX slot | Low | Define the **shared `AdaptationRecommendation` contract now** with a `source` discriminator so 14b feeds the same banner, not a second one. |

## Rollback Plan

Purely additive. No destructive migration and no change to existing endpoints, the
regenerate → generate path, or the week board.
- **Track D:** remove the mobile banner; the mobile plan/regenerate surface (Track C) keeps working.
- **Track C:** remove the RN plan/regenerate port; `apps/mobile` returns to its pre-14a state (no
  plan surface); web is unaffected.
- **Track B:** remove the web banner + `adaptation` i18n; the dashboard and regenerate are unchanged.
- **Track A:** the new contract type, domain function, and read field are unused if B/C/D are
  reverted; drop them. The dashboard summary keeps its prior shape.
The existing adherence stats, dashboard, plan/regenerate, and billing gate continue functioning
at every rollback point.

## Relation to README roadmap

Implements roadmap item **14a — v1.1 adaptation from adherence**: compare completed vs planned
over a configurable period and, below 70% adherence, **suggest** a lower-frequency plan the user
confirms — materialized through the existing AI regenerate path (08). It builds on the adherence
signal (09c), offline history (09b, dependency), the plan/regenerate mechanism (07/08), and the
billing gate (11a/11b). It is the first half of the v1.1 adaptation pair and deliberately defines
the **shared adaptation-recommendation contract** consumed later by item **14b — v1.1 adaptation
from RPE**, so the two compose into one surface rather than competing banners.

## Dependencies

- `09b-v1-workout-offline-history` — canonical spec dependency (completed-session history).
- 09c progress dashboard — `computeAdherence`, `getDashboardSummary` (60-session history +
  latest ready plan + `plannedSessionsPerWeek`), `DashboardSummaryDTO` — reused.
- 07/08 plan model + AI generation — `PlanSpec`, write-once `workout_plans`,
  `POST /plan-specs/:id/regenerate` → adjusted spec → `startGeneration` — reused unchanged.
- 11a/11b billing — `plan_regeneration` gate (Free = 1/month) reused unchanged at confirm.
- Web `regeneratePlan` client (`create-plan/plan-draft-client.ts`) — reused for accept.
- **14b (RPE)** — not a dependency, but the shared `AdaptationRecommendation` contract is defined
  here for 14b to consume.

## Success Criteria

- [ ] A pure `computeAdherenceAdaptation` computes adherence % over a configurable rolling window
      (default 4 weeks) and marks adherence low below 70% (5 of 16 in 4 weeks → low).
- [ ] At 31% adherence the recommendation suggests reducing frequency from 4 to 3 days/week.
- [ ] The recommendation is deterministic domain code — no LLM in the recommendation path; the LLM
      is used only via the existing regenerate → generate path to materialize the adjusted plan.
- [ ] Insufficient data (no active ready plan, `plannedSessionsPerWeek = 0`, < 1 period of history)
      yields **no recommendation**.
- [ ] The recommendation read consumes **no** billing quota and is available to all tiers.
- [ ] Accepting a recommendation adjusts `PlanSpec.daysPerWeek` and regenerates via the existing
      endpoint, consuming exactly one `plan_regeneration`; rejecting leaves the plan unchanged and
      consumes nothing; there is no auto-apply path.
- [ ] Adherence is surfaced as a separate percentage/banner; `WeeklyDayStatus` gains no "missed" state.
- [ ] The shared `AdaptationRecommendation` contract exists with a `source` discriminator so 14b (RPE)
      feeds the same banner slot.
- [ ] Web: the suggestion banner renders on `DashboardCoachCard` with accept/reject; `adaptation` i18n
      exists in EN + ES with empty/insufficient/error states.
- [ ] Mobile: the plan/regenerate flow is ported to RN (Track C) and the adherence banner confirms via
      that flow (Track D), with the same confirm-only quota behavior as web.
