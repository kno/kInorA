# Exploration: 14a-v1.1-adaptation-adherence

**Status:** Not started. Only a ~1.1K canonical spec scaffold exists at `openspec/specs/14a-v1.1-adaptation-adherence/spec.md` — it already encodes hard constraints: the system MUST compare completed vs planned sessions over a **configurable period**; SHOULD recommend lower frequency/volume when adherence drops **below 70%** (scenario: 31% → suggest 4→3 days/week); adherence-based changes MUST be **suggestions requiring user confirmation** (rejecting leaves the plan unchanged). Dependency: `09b-v1-workout-offline-history`.

## What 14a is
First of the v1.1 "dynamic plan adaptation" pair (14b = RPE/perceived-intensity — 14a is **adherence only**). Observes whether the user is actually completing planned sessions and, when adherence is poor, **suggests** an adjustment (reduce frequency/volume) rather than leaving a stale plan. Not a new AI brain — the adherence signal exists (09c) and the plan-change mechanism exists (regenerate); 14a wires adherence signal → recommendation → the existing plan-change path, gated on user confirmation.

## Current state (evidence-based)

### 1. Adherence data that already exists
- `computeAdherence` (`packages/domain/src/progress/adherence.ts`) is pure but **current-week only**: `completedAtDates` in the current UTC week vs `plannedSessionsPerWeek` → `{weeklyCompleted, weeklyPlanned}`. No multi-week / percentage / trailing-window today — the spec's "5 of 16 in 4 weeks" + "configurable period" need a NEW domain calc.
- Aggregation: `WorkoutSessionRepository.getDashboardSummary` (`apps/api/src/db/repositories/workout-session.ts`) loads the last **`DASHBOARD_HISTORY_LIMIT=60`** completed sessions + the single latest `status='ready'` plan; derives `plannedSessionsPerWeek = latestReadyPlan.programJson.weeklySessions.length`; also `computeStreak`, `recentDailyCompletion`, `computeWeeklyRollup`. Output `DashboardSummaryDTO` (`packages/contracts/src/index.ts:840`).
- Model: `workout_sessions` (`apps/api/src/db/schema.ts:627`) has `workoutPlanId`, `status ('active'|'completed')`, `day` (nullable), `completedAt`. "Planned" = `workout_plans.program_json.weeklySessions[]` (weekly template). **No per-date schedule table** — plan is a weekly template implicitly repeated, so "planned over N weeks" ≈ `plannedSessionsPerWeek * N`.
- Deliberate gap: `WeeklyOverviewDTO`/`WeeklyDayStatus` is `"done"|"active"|"rest"|"soon"` — **no "missed" state** (contracts index.ts:873). 14a's missed/behind notion MUST be reconciled with that decision.

### 2. Plan/program model — mutability
- `PlanSpec` (`packages/contracts/src/index.ts:332`) = mutable input (goal, daysPerWeek, sessionDurationMinutes, location, equipment, limitations, preferenceScores, confirmed, name); stored in `plan_specs.spec_json`.
- `WorkoutProgram` (index.ts:37) = generated output (weeklySessions[]); stored in `workout_plans.program_json`.
- `workout_plans` rows are **write-once** (`markReady` sets program_json once; no in-place edit). `WorkoutPlanRepository` creates a new row per generation. So "adapting" = adjust `PlanSpec.daysPerWeek` (+ optionally sessionDurationMinutes/preferenceScores) and **regenerate**. No cheap "skip/de-load one session in place" primitive.

### 3. AI generation stack to reuse (08)
`DynamicPlanGenerator.generate(spec)` + pure `buildPlanPrompt(spec)` (with a `memoryContext?` seam) + `PlanGenerationService.startGeneration` (fire-and-forget). Assessment: the RECOMMENDATION (adherence% → "4→3 days") is a **deterministic rule** → domain layer beside `computeAdherence` (pure, cheap, testable). The LLM is only needed to MATERIALIZE the adjusted plan — which the existing regenerate→generate path already does from the adjusted PlanSpec. No new LLM call type required.

### 4. Trigger/cadence
**No job scheduler exists** (grep cron/node-cron/bull/agenda/setInterval → none). Feasible: **on-demand at read time** (the dashboard already fetches the 60-session history + latest plan) or **event-driven** (after a session completes). A weekly cron sweep = net-new infra, out of scope.

### 5. Billing/entitlement
`apps/api/src/billing/plan-limits.ts`: `FREE_TIER_LIMITS={plan_generation:1, plan_regeneration:1, memory_write:0, memory_retrieval:0}`; Pro config-driven. `POST /plan-specs/:id/confirm` consumes `plan_generation`; `POST /plan-specs/:id/regenerate` consumes `plan_regeneration` (Free = 1/month). **Critical:** an auto-applied adaptation that regenerates would silently burn the Free user's single monthly `plan_regeneration` → strong argument for suggest-and-confirm (recommendation consumes nothing; quota only on user-confirmed regenerate). Whether the recommendation itself is Pro-gated is an OPEN decision (no `AdaptationEntitlementPort` exists; recommendation is cheap enough to ship Free).

### 6. UX surface
Web dashboard: `apps/web/src/app/(app)/dashboard/DashboardCoachCard.tsx` + `DashboardTodayBlock.tsx` — the **coach card is the natural home for a suggestion banner**. Plan view: `apps/web/src/app/(app)/plan/` + `plan/[id]/PlanStatusView.tsx`; regenerate is client-wired via `regeneratePlan` (`create-plan/plan-draft-client.ts`). **Mobile** (`apps/mobile`, Expo RN) has HomeScreen + tracker/history but **no create-plan/plan-view/regenerate** → adaptation confirmation on mobile needs that surface first → web-first is low-blast-radius (API shared). Spec MANDATES suggest-and-confirm; auto-apply is spec-forbidden.

### 7. i18n / hexagonal / tenant
New `adaptation` i18n namespace (EN/ES parity). Policy = pure domain fn in `packages/domain/src/progress/` (no I/O). API aggregates, route orchestrates, web/mobile render; LLM confined to apps/api/src/ai. Every read tenant+user scoped from authContext.

## Approaches
| Approach | Pros | Cons | Effort |
|---|---|---|---|
| **A. Deterministic domain policy + suggest-and-confirm banner + reuse regenerate** | Cheap, deterministic, unit-testable; consumes NO quota until confirm; reuses shipped generation/billing/UX; smallest blast radius; satisfies MUST-confirm | Introduces "behind/missed" the WeeklyOverview omits (reconcile); confirm still spends 1 monthly plan_regeneration | **Med** |
| B. LLM "adherence-context" regeneration | Richer adjustments | LLM cost/latency/nondeterminism in the recommendation; harder to test; deterministic rule already meets spec | High |
| C. In-place plan mutation | No quota; instant | No mutable-plan primitive (write-once); new schema/edit path | High |
| D. Scheduled/cron sweep | Proactive nudges | No scheduler infra; net-new job system | Very High |

## Recommended first slice
**Deterministic, web-first, suggest-and-confirm (Approach A).**
1. Domain: pure `computeAdherenceAdaptation` beside `computeAdherence` — input `{completedAtDates, plannedSessionsPerWeek, periodWeeks}`, output `{adherencePercent, level:'ok'|'low', recommendation?:{kind:'reduce_frequency', fromDays, toDays}}`. Threshold `<70%`; 4→3 mapping per spec. Reuse the already-fetched 60-session history + latest ready plan.
2. API: expose the recommendation on the dashboard summary path (or a small `GET /adaptation/adherence`, tenant/user-scoped, consuming nothing). Confirmation reuses `POST /plan-specs/:id/regenerate` after adjusting `PlanSpec.daysPerWeek` (consumes plan_regeneration — never auto).
3. Web: suggestion banner on `DashboardCoachCard` (accept → regenerate w/ reduced days; reject → unchanged). New `adaptation` i18n (EN/ES).
4. Defer: LLM adaptation, mobile confirmation UI, auto-apply, scheduled sweeps, volume/de-load beyond frequency.

## Open questions a proposal must resolve
1. Deterministic rule vs LLM (recommend deterministic; LLM only via existing regenerate).
2. Adherence window ("configurable period" = rolling 4 weeks?) + threshold→action table beyond `<70%`/`31%→4→3`; frequency-only in slice 1 vs volume/de-load.
3. Auto-apply vs suggest-and-confirm → spec MANDATES confirm.
4. On-demand vs event vs scheduled → no scheduler → on-demand at dashboard read.
5. Mutate vs new plan → write-once → adjust PlanSpec.daysPerWeek + regenerate.
6. Quota: confirm consumes 1 plan_regeneration (Free=1/mo). Acceptable, or exempt/separate for adherence-driven regen? Is the recommendation Pro-gated or free?
7. Web-only vs web+mobile (mobile has no plan/regenerate surface → recommend web-first).
8. Reconcile with "no missed state".
9. Sequencing with 14b (RPE): define a shared "adaptation recommendation" contract so both compose into one surface.

## Risks
- Silent quota burn if auto-regenerated → suggest-and-confirm, consume only on confirm.
- Contract conflict with the deliberate "no missed state" model → reconcile explicitly.
- No scheduler → on-demand/event only.
- Edge cases: no active ready plan, `plannedSessionsPerWeek=0`, new user with <1 period history, 60-session limit truncating the window → domain fn must handle (no recommendation when insufficient data).
- Coaching tone: suggestions never diagnoses; copy in i18n.
- Mobile divergence if web-only without noting it → state the platform decision.

## Next
`sdd-propose` — recommended first-slice scope above. Engram topic `sdd/14a-v1.1-adaptation-adherence/explore` (id 2413).
