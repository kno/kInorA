# Exploration — 17c-profile-body-metrics

Source issue: [kno/kInorA#361](https://github.com/kno/kInorA/issues/361) — "profile: capture sex, weight and height, and use them in generation and imagery".

Read-only investigation. No code changed. The issue is unusually well-researched and its claims verify; this document confirms them and adds what it missed.

## 1. Issue claims — verified

| Claim | Evidence | Verdict |
|---|---|---|
| `user_profiles` has no body columns | `apps/api/src/db/schema.ts:950-969` — `userId`, `name` (NOT NULL), `goal`, `experienceLevel`, `createdAt`, `updatedAt` | Confirmed |
| `PlanSpec` has no physiological data | `packages/contracts/src/index.ts:407-446` | Confirmed |
| The only `weightKg` is load lifted, not the person | `apps/api/src/db/schema.ts:766` — `set_records.weightKg`, nullable | Confirmed; no bodyweight column exists anywhere |
| The wizard never asks | `apps/web/src/components/wizard/` covers exactly the six `PlanSpecDraftField`s (`packages/contracts/src/index.ts:1275-1281`) | Confirmed, with a correction — see §2 |
| 29 `(male)` / 4 `(female)` of 1,324 catalog records | Corroborated from the issue body only | **Not independently re-derived.** If the count is load-bearing for the design, re-run it against the generated JSON |

## 2. Write path for a new profile field — seven layers, and a correction

The issue says "the wizard is `apps/web/src/components/wizard/`". That is the **plan-creation** wizard, which captures `PlanSpec` inputs for generation. Sex, weight and height belong on the **profile** page, a different screen. The pattern to mirror is `goal` / `experienceLevel`, not the wizard.

For a new 1:1 scalar (e.g. `sex`):

1. **Schema** — `apps/api/src/db/schema.ts`, `userProfiles` (nullable column, plus an enum if needed)
2. **Contracts** — `packages/contracts/src/index.ts`, `UserProfile` and `UpdateProfileRequest` (~lines 242-278)
3. **API route** — `apps/api/src/routes/user-profile.ts` (`GET`/`PUT /user-profile`, `UserProfileRouteRepo` port)
4. **Repository** — the Drizzle repo implementing that port under `apps/api/src/db/repositories/`
5. **Web API client** — `apps/web/src/app/(app)/profile/profile-form-client.ts` (`fetchUserProfile`, `updateUserProfile`, `isUserProfile`)
6. **Web server action** — `apps/web/src/app/(app)/profile/actions.ts` (`saveProfileAction`)
7. **Web component + i18n** — `ProfileForm.tsx`, `options.ts`, and `packages/i18n/src/messages/{en,es}.json` under `profile.form.*`

### Mobile has no profile screen at all

`grep -rl "UserProfile\|experienceLevel" apps/mobile/src` returns **zero matches** (independently confirmed).

Scope A on mobile is a **greenfield build** — new screen, new API client, new i18n wiring using mobile's own `react-intl` per-screen `messages.ts`, not the shared `next-intl` catalogs. This is not "add a field to an existing form" and it materially changes the size estimate.

### The weight series is a different shape entirely

Weight is 1:many with the user — a series of dated readings — so it needs a new table, route and repo, unlike the 1:1 scalars.

## 3. Weight time series — cascade confirmed, nothing exists to feed it

The `ON DELETE CASCADE` convention is universal for user-scoped child tables: `userProfiles:955`, `userPreferences:985`, `trainerClientAssignments:1037/1042`. A new `user_weight_entries` should follow the same shape — `userId` referencing `users.id` with cascade, `weightKg numeric`, `recordedAt`, `createdAt` — and, unlike `userProfiles`/`userPreferences`, **no unique index on `userId`**, since it is a series.

**No user-level series charting exists today.** The only trend concept is `StatsSummaryDTO.volumeTrend` (`apps/web/src/app/(app)/stats/page.tsx:218-236`), whose shape is two aligned arrays with no dates. It is not reusable for a dated weight series, though its bar-rendering pattern could be borrowed.

## 4. Bodyweight volume — confirmed zero today, and it WILL rewrite history

`apps/web/src/app/(app)/plan/[id]/tracker/tracker-model.ts:116-121`:

```ts
export function exerciseVolume(exercise: SessionExerciseRecord): number {
  return exercise.setRecords.reduce(
    (sum, set) => sum + (set.weightKg ?? 0) * (set.actualReps ?? 0), 0,
  );
}
```

A bodyweight set contributes `0 * reps = 0`. Confirmed exactly as the issue claims.

Volume is computed with this same formula in `tracker-model.ts:116-121, 183-184` (`exerciseVolume`, `sessionVolume`, `activeExerciseVolume`) and in the API stats aggregation feeding `StatsSummaryDTO.totalVolumeKg` / `volumeTrend` — the API-side computation was **not read this pass** and should be confirmed during design.

### The retroactivity problem

There is **no per-set stored volume snapshot**. The tracker and stats query historical `set_records` rows live and multiply by whatever the current formula is.

So the moment a user first enters their weight, every bodyweight-only set they have **already logged** changes from volume-zero to volume-nonzero. `totalVolumeKg`, `volumeTrend` and PR calculations shift for **past** sessions. Stats before and after that moment are not comparable.

The #353 retention funnel is **not** affected — its steps are activity-based, not volume-based (`apps/web/src/app/(app)/admin/stats/stats-constants.ts:39-48`). The user-facing Stats volume KPI and the PR table are.

Three ways out, none of them free, and this is a decision the issue does not resolve:

- **(a) Snapshot bodyweight at set time** — historical volume stays stable, only future sets change. Costs a column and a write-path change.
- **(b) Accept the retroactive shift** as intentional — "we now count what you actually lifted" — and communicate it.
- **(c) Surface bodyweight volume as a separate additive metric**, leaving `totalVolumeKg` untouched.

## 5. Imagery rule — narrower than it sounds

`packages/exercise-catalog/src/catalog.ts` is the query surface over a generated JSON. **No `gender`/`sex` field exists** on `ExerciseCatalogRecord`; the 29/4 signal is a substring match on the record name.

Media selection happens at `apps/web/src/app/(app)/exercises/exercise-catalog-client.ts` feeding `[id]/ExerciseMediaCard.tsx` — the natural insertion point. **A mobile equivalent was not located this pass** and needs a grep before scope C is sized for mobile.

With 33 gendered records out of 1,324, the rule can only ever suppress one of ~33 records, and only when an ungendered equivalent exists for that same movement — which the data does not guarantee. If a `(male)` variant is the only record for a movement, there is nothing to substitute and the rule is a no-op. This is **best-effort suppression**, not "gender-appropriate imagery".

## 6. Privacy — the invariant holds, and the channel the issue misses

### The observability invariant is structural

`apps/api/src/observability/event-logger.ts:19-27` types `ObservabilityMetadata` as `Record<string, string | number | boolean | null | undefined>` — a flat scalar bag. The type system prevents passing nested objects, arrays or free text. You cannot compile a call that hands it a `PlanSpec` or a prompt string.

But note the limit: it cannot stop someone passing a *new scalar* like `weightKg` as metadata. That remains a discipline requirement on the implementer.

### The Langfuse channel — the most important finding, and the issue never names it

Verified directly:

- `mask()` (`apps/api/src/ai/mask.ts:17-29`) redacts **only** the literal `limitations[].text` terms handed to it. Nothing else.
- `invokeChain` (`apps/api/src/ai/adapter-factory.ts:66+`) builds `limitationTerms` from `spec.limitations`, calls `mask(rawPrompt, limitationTerms)`, then `.invoke(maskedPrompt, { …, callbacks: [handler] })`.
- `handler` is the Langfuse `CallbackHandler` (`apps/api/src/ai/langfuse-handler.ts:53-79`), attached whenever `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are configured — which they are in production, as of the `16e` series.

**The masked prompt is the trace input.** Anything that survives `mask()` is sent verbatim to a third-party vendor.

Today nothing leaks: `PLAN_PROMPT_TEMPLATE` (`apps/api/src/ai/prompt.ts:47-77`) and `buildPlanPromptVariables` (`:128-193`) carry no body data.

**If scope B adds sex, weight and height to the prompt as the issue plans, that data survives `mask()` untouched and goes to Langfuse.** This is structurally the same class of hole as issue #374 — which is open about limitation text on first mention — except #374 is about limitations, and this is an entirely new field class the issue never names.

The same applies to the chat create-plan flow: `extraction-adapter.ts` and `extraction-prompt.ts` route through `linkStreamingModel` / `linkStructuredChain` with the same handler injection.

Three ways to close it:

- **(a) Extend `mask()`** (or add a parallel step) to redact body-metric values before `invoke()`. Smallest change, mirrors the existing pattern exactly.
- **(b) Never place raw body values in traced input** — derive a server-side fragment and pass only that.
- **(c) Exclude `plan-generation` traces from Langfuse when body data is present** — broader behaviour change, likely undesirable.

This must be an explicit line item in the proposal, not an implicit "we will be careful".

## 7. The `.withStructuredOutput()` boundary

`packages/contracts/src/workout-program.schema.ts:7-14` defines `WorkoutExerciseSchema` (`name`, `sets`, `reps`, `restSeconds`, `notes?`), used via `.withStructuredOutput(WorkoutProgramSchema, …)` at `adapter-factory.ts:139, 159, 179, 199, 228` — every provider adapter.

That schema is the **model's output shape**, repeating once per exercise per session. A per-user scalar has no natural home there anyway. The issue's #357-citing warning is correct and the boundary states precisely:

> Never add a field to `WorkoutExerciseSchema`, `WorkoutSessionSchema` or `WorkoutProgramSchema`. Body data belongs only in the rendered prompt string — input, never output.

## 8. Open questions — presented, not decided

**(a) Sex vs. gender, and the value set.** These are two different things. Sex is what the load and limb-length heuristics in scope B want. Gender identity is what the imagery rule in scope C wants. One dropdown cannot honestly serve both — it either mislabels what is being asked or serves one purpose badly. Two fields means more UI and more explaining.

Note a subtlety on "prefer not to say": `experienceLevel` already uses null to mean "not chosen yet". If the product wants to distinguish *asked and declined* from *never asked*, "prefer not to say" must be a positive value, not reused null.

**(b) Units.** Existing precedent is SI-only with no unit field and no user choice — `set_records.weightKg` has never asked. Either keep that (simplest, consistent, forces non-metric users to convert mentally) or store canonical SI and toggle kg/lb and cm/ft-in at the input edge (conversion logic, a stored or inferred unit preference, locale-based default). This would be the app's first user-facing unit choice, so no existing pattern favours either.

**(c) Health-data privacy class.** The app has an informal category — self-reported limitations, masked from traces — but no formal health-data classification, retention policy or consent flow beyond "optional and nullable". Weight and sex deserve at least the same treatment as limitations. Whether they need more (explicit consent copy, a distinct retention story beyond cascade-on-user-delete) is a product and legal decision this exploration cannot make.

**(d) Added by this exploration — the weight resolution rule.** Scope C needs a defined rule for which reading counts: closest at-or-before the session date, most recent regardless of date, or exact-date-only with no bodyweight contribution otherwise. This is a design gap, not an implementation detail, because it directly determines whether historical volume is stable (see §4).

## 9. Size signal — non-test / test

Order-of-magnitude, based on analogous existing patterns rather than a line count. The 800-line budget is measured on **non-test** lines.

| Scope | Non-test | Test | Notes |
|---|---|---|---|
| A — capture | ~450-650 | ~350-500 | The new mobile screen and the weight-series table/route are the bulk. A scalar field alone, mirroring `goal`, would be ~80-120 |
| B — feed generation | ~120-200 | ~150-250 | Includes the `mask()` extension from §6. Byte-identical-when-absent prompt tests will be numerous |
| C — volume + imagery | ~150-250 | ~200-300 | The formula is small; the resolution rule and stats changes are the bulk. The retroactivity decision needs deliberate coverage either way |

**Total non-test: ~720-1100** — at or over budget before scope A's mobile and weight-series growth is counted precisely.

Recommendation: chain as multiple PRs, and split scope A further — web scalars, weight series, mobile — rather than one PR per scope. Scope A is the largest single risk to the budget.

## Risks carried forward

- The Langfuse trace leak (§6) must be closed in scope B's design, not left implicit.
- Mobile profile is greenfield, not an edit.
- Bodyweight volume retroactively changes historical stats unless deliberately prevented (§4).
- The 29/4 catalog count was not independently re-derived; spot-check it if the design depends on it.
- The API-side volume computation was not read; confirm during design.
- No mobile media-selection point was located; grep before sizing scope C for mobile.
