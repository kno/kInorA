# Design: Progress Dashboard, Statistics & Weekly Overview (09c)

## Overview

Change 09c builds the three web surfaces where a user sees how their training is going. All three read from the workout history the app already records; none of them add a new way to log workouts.

1. **Dashboard** — the "how am I doing right now" screen. It shows today's recommended session, the user's day-streak (consecutive days with a completed workout), and weekly progress as an X-of-Y count of completed vs. planned sessions this week.
2. **Statistics** — the "how am I trending" screen. It shows four headline numbers (total volume, session count, total training time, and how many personal records were set), each compared against the previous period; a volume trend chart; a muscle-group distribution bar chart; and a list of personal records.
3. **Weekly plan board** — the "what does my week look like" screen. It shows a 7-day Monday-to-Sunday calendar with each day marked done, active, rest, or soon, and lets the user page between weeks.

This change is web-first. Mobile versions of these surfaces are explicitly out of scope here.

The guiding principle throughout is reuse. 09c stands on the foundation that change 09b already laid: the same batch-fetch data pattern and the same style of pure, testable aggregation functions. We add new aggregation on top of that base, keep it pure, and wire it into purpose-built read queries and thin API routes.

## How the pieces fit together

Data flows in one direction, from the database, through pure aggregation, out to the pages:

    session_exercises.muscle_group ──┐
    workout_sessions (day, completedAt) ──┤
    workout_plans (programJson, createdAt) ──┤
       │  ProgressRepository  (bounded batch-fetch queries, no N+1)
       ▼  DTOs  (@kinora/contracts)
    @kinora/domain/progress  (pure functions: streak, adherence, distribution, PRs, weekly rollup, classify)
       ▼
    apps/api  /progress/*  thin routes  ──▶  web Server Components / Actions  ──▶  OpenDesign-built pages

The repository fetches raw rows in bounded queries. The pure domain functions turn those rows into the numbers each screen needs. The API routes are thin pass-throughs. The web pages render the results using the OpenDesign kiNorA design.

## The three surfaces in product terms

### Dashboard (`web-dashboard.html`)

The dashboard is built from several modules. 09c only owns the data for some of them; the rest are either static or belong to future changes.

- A "Sesión recomendada hoy" hero card: session title, a lead line, three hero-stats (expected duration, estimated volume, number of exercises), and the "Empezar sesión" / "Ver plan" call-to-action buttons.
- A progress panel of two score cards: **"Racha activa"** (the streak, shown as a big number plus a 7-bar sparkline) and **"Progreso semanal"** (X/Y sessions, with a sub-line like "una sesión pendiente…" and bars).
- A "Ruta de carga" week-route strip: five day cards, each with the day, its focus, and a per-day load-fill bar.
- A "Siguiente sesión" next-up card and a "Bloque de hoy" session list (exercise rows with name, series·reps, RPE).

The data points 09c is responsible for are: the streak value, the weekly-progress completed/planned counts, the week-route per-day focus and load, and recent-session context. Weekly progress is always measured in **sessions** (for example 4/5), not in any other unit.

Two things on this screen are out of 09c scope and must not be implemented here: the Coach AI card, and the readiness ring (the "82" overlay on the hero) — there is no readiness data model in this change.

### Statistics (`web-stats.html`)

The statistics screen opens with a period toggle (Semana / Mes / Año). Below it:

- A KPI row of four cards, each showing a value **and a delta versus the previous period**: Volumen total (kg), Sesiones (count), Tiempo total (h/min), and PRs/récords (count).
- A **volume trend** area/line chart that overlays the current period against the previous one.
- A secondary row with two visualizations. The first, "Series por grupo muscular", is a **horizontal bar chart of set counts**. The second, "Distribución de entrenamientos", is a donut of workout *type* (Fuerza / Cardio / Movilidad) — that donut is **out of scope** for 09c because we do not track workout type.
- A **PR table** with the columns Ejercicio · 1RM estimado · Fecha · Tendencia (a sparkline with a signed delta).

Note that there is deliberately no adherence KPI on this screen. Adherence lives on the dashboard instead (see the data-model decisions below).

### Weekly plan board (`web-plan.html`)

The weekly board is a 7-day calendar week, Monday to Sunday, rendered as a grid of day cards. It has previous/next week navigation and a week label showing the calendar dates (for example "8–14 jun"). Each day card shows the day and date, a status glyph, a focus title, a mini bar-stack, and meta (number of exercises · minutes). The four possible day statuses are **done** (✓), **active** (▶), **rest** (–), and **soon** (•). There is no "missed" state.

The side rail on this screen (readiness ring, today's exercise blocks, Coach IA) is mostly out of 09c scope.

### Exercise detail

There is no dedicated web design for per-exercise history. `muscle-library.html` is a filterable gallery of the 44 muscle images and the source of the taxonomy labels — it is not a history view. The closest reference is `mobile-exercise.html` (instructions / series / rest). We implement the read-only recent-history section as an additive block using the existing card and list primitives, and when there is no history for the exercise we simply omit the section (matching the spec).

## Technical decisions

### Where the aggregation code lives, and why the subpath matters

All new aggregation is pure and lives in `packages/domain/src/progress/`. It is exported **only** through a new `@kinora/domain/progress` subpath — never through the root `@kinora/domain` barrel.

The reason is concrete: the root barrel re-exports `auth/password`, which uses scrypt and therefore pulls in `node:crypto`. If a Next.js page imported anything through the root barrel, that `node:crypto` dependency would break the web build. The project already solves this with client-safe subpaths (`./plan` and `./offline`), and `./progress` follows the same established pattern. So `packages/domain/package.json` gains a `./progress` export, and no progress code ever leaks through the root barrel.

The new DTOs live in `packages/contracts`, and the API routes in `apps/api` are thin. We follow strict TDD: the pure domain aggregation is unit-tested, the repository queries and routes are integration-tested, and the pages are component-tested. Internationalization uses next-intl plus `@kinora/i18n` with EN/ES parity from day one.

### Muscle-group taxonomy

We settled on **10 primary muscle groups**: chest, back, shoulders, biceps, triceps, core, glutes, quads, hamstrings, and calves. These are defined as a `MuscleGroup` union together with a `MUSCLE_GROUPS` constant in `packages/contracts`, mirroring the OpenDesign muscle library manifest (`assets/kinora-muscles/library-manifest.json`). Contracts is the cross-boundary source of truth, and 10 primary groups give us clean distribution buckets that never double-count.

Composite or regional slugs are kept separate as an optional `MuscleRegion` type, used for plan-focus grouping — they are never a distribution bucket. We rejected free-form strings (no shared vocabulary) and rejected using the full 22-slug enum as buckets (composites would double-count).

### How exercises get a muscle group

We add a new `muscle_group varchar` column to the `session_exercises` table. The column is **nullable and additive**, which means rolling this back is just dropping the column with no data loss. We chose `session_exercises` because it is the immutable snapshot table and this fits its copy-on-write pattern. We rejected a new `exercise_catalog` table and rejected putting the column on `set_records`: exercise titles are free text today, and building a catalog would be scope-creep beyond this change.

**Immutable-table carve-out.** `session_exercises` is documented as an immutable snapshot, and populating/backfilling `muscle_group` might look like it violates that invariant — it does not. `muscle_group` is **derived classification metadata**, not part of the immutable workout-record data. The immutable snapshot is the *what-happened* record: the exercise title, its order, rest, notes, and the sets logged against it. `muscle_group` is a computed label *about* that record (a deterministic function of `title`), carries no user-logged information, and can be recomputed at any time from the title. Writing or backfilling it therefore does not mutate the workout record; the invariant is more precisely stated as **"immutable except the derived `muscle_group` classification column."** The schema comment on `session_exercises` must be updated to say exactly that (tracked as an apply task). We keep both the write-time populate and the idempotent backfill.

The column is filled by a single pure classifier, `classifyExerciseMuscleGroup(title): MuscleGroup | null`, a keyword heuristic living in `packages/domain/src/progress/`. It runs in two places: at write time inside `insertSessionExercises`, and again in a backfill. Using one classifier for both keeps the logic in one fully unit-testable place. We rejected doing this enrichment at AI-generation time (that is change 08, which is not in scope).

**Title normalization (shared by the classifier and PR grouping).** Both the classifier's keyword cache and the personal-record grouping key an exercise off a **normalized title**, produced by the same normalization: trim, lowercase, collapse internal whitespace to single spaces, and strip diacritics/accents (Unicode NFD → drop combining marks, so "Sentadilla" and "sentadílla" collapse, "Press Militar" and "press  militar" collapse). This makes matching case-, spacing-, and accent-insensitive across EN/ES input. **Documented limitation:** normalization does **not** merge true synonyms or wording variants — "Bench Press" and "Barbell Bench Press" (or "Press de banca") remain distinct keys — so PR history can fragment across differently-worded titles for the same movement. Synonym/alias resolution is out of scope for v1.

**Bilingual classifier (EN + ES).** The app ships EN/ES, and exercise titles arrive in both languages, so the keyword classifier **must carry keyword sets in both English and Spanish**. The Spanish muscle-group seeds mirror the OpenDesign muscle-library manifest labels: Pecho (chest), Espalda (back), Hombros (shoulders), Bíceps (biceps), Tríceps (triceps), Core/abdominales (core), Glúteos (glutes), Cuádriceps (quads), Isquiosurales (hamstrings), Gemelos (calves) — plus common EN/ES exercise terms (e.g. bench/press de banca, squat/sentadilla, deadlift/peso muerto, row/remo, curl, pull-up/dominada). All keyword matching runs against the normalized title above. **Unmapped titles degrade to `null` and are excluded** from the distribution (they still count toward volume, sessions, trends, and PRs) — this is the accept-null / graceful "no distribution" default, and it also settles the former "classifier keyword coverage" open question: v1 accepts null-degrade rather than enforcing a coverage threshold.

The backfill is an idempotent, re-runnable script in `apps/api/src/db/`. It scans `session_exercises WHERE muscle_group IS NULL`, classifies the title, and updates the row. **It batches/chunks over rows** (e.g. process in bounded pages ordered by `id`, committing per batch) so it stays safe on a large table and can resume after an interruption without re-scanning committed work. Being re-runnable means it survives partial failures and picks up any new NULL rows later; we rejected a one-shot migration data step for that reason. Exercises the classifier cannot map stay NULL and are simply excluded from the distribution — a graceful "no distribution" degrade rather than an error. **Reclassify path:** the `WHERE muscle_group IS NULL` filter only fills gaps; it will *not* fix rows the classifier previously mis-labeled. When the classifier logic is later improved, a **versioned/explicit reclassify** is required — either an explicit "reclassify all" run (recompute every row, not just NULLs) or a stored `classifier_version` compared against the current version to target stale rows. Both stay idempotent.

### The week model: calendar week, Monday–Sunday

The week is the **calendar week** (Monday to Sunday), matching the "Plan semanal" board in `web-plan.html`. It is *not* a plan-week anchored to `workout_plans.createdAt`. The board renders 7 day cards for the currently-displayed calendar week, with previous/next week navigation and a date-based week label.

Each day resolves to exactly one status:

- **done** — a completed session happened that day,
- **active** — the day is today,
- **rest** — a planned rest day,
- **soon** — a future planned training day.

There is no "missed" status. Completed days come from distinct `workout_sessions` with `status = 'completed'` and a `completedAt` inside that calendar week. The weekly rollup (completed vs. planned sessions) is computed per calendar week.

We rejected a plan-week anchored to `createdAt` because the OpenDesign board is clearly a dated, navigable calendar week and the design is the source of truth. We rejected a bare `weeklySessions` index with no dates (it can't produce per-day calendar status or navigation) and rejected a new `plan_days` calendar table (heavy and out of scope). The calendar week grounds each day's status in real dates without any new tables.

#### Planned-day → weekday mapping (grounded in the real model)

**What the model actually is.** `programJson.weeklySessions[].day` is a **1-based sequential plan-day index** (`1..daysPerWeek`), not an ISO weekday. The contract comment reads "Day number within the week (1-based)"; the plan view renders each session as "Día {n}" (a sequential label, never "Lunes/Martes"); `restDays = max(0, 7 − weeklySessions.length)`; and `workout_sessions.day` (smallint, #93) stores this same sequential index purely for resume matching. **There is no calendar-weekday anchor anywhere in the model** — nothing records which real weekday a plan's session #k is meant to fall on.

Because of this, the two halves of a day's status are grounded differently:

- **"done" is fully grounded in real dates.** A day shows **done** when at least one `workout_sessions` row with `status = 'completed'` has a `completedAt` bucketed into that calendar day (UTC bucketing — see "Timezone" below). This is real, dated data and needs no mapping.
- **The planned overlay (soon / rest / active) uses a deterministic display convention, because the model has no real weekday.** For v1 we place the plan's `N = weeklySessions.length` training days into the **first N weekday slots of the displayed calendar week starting Monday** (plan day index 1 → Monday, 2 → Tuesday, …, N → the Nth day), and the remaining `7 − N` days are non-training days. This is exactly the sequential "Día 1 first" convention the plan view already uses — it is not new scheduling data, it is a stable display ordering.

  Each day's status is then resolved in a strict precedence, which is exhaustive (every day gets exactly one status):
  1. A day with a real completed session shows **done** (driven by its `completedAt`), including today.
  2. Otherwise, **today** shows **active**.
  3. Otherwise, a *future* planned training slot shows **soon**.
  4. Otherwise the day shows **rest**. This bucket deliberately absorbs three cases: planned rest days, any non-training day, and a *past* planned training day with no completed session (a skipped day). There is intentionally **no "missed" status** — a skipped past training day simply renders as **rest**, so the board never accuses the user of a miss.

> ⚠️ **NEEDS PRODUCT DECISION (planned-day weekday placement).** The Monday-first sequential fill above is a *display convention*, not real per-user scheduling — the model does not know which weekdays a user actually trains. Options for a future change: (a) keep the sequential Monday-first fill (v1 default, no schema change); (b) add a per-plan training-weekday schedule (e.g. `weeklySessions[].weekday`) captured in the wizard/generation; (c) infer each index's weekday from the user's historical `completedAt` pattern. v1 ships option (a) and treats the planned overlay as advisory; the **done** status (real dates) is always authoritative and never overridden by the convention.

#### getWeeklyOverview scoping and out-of-range weeks

`getWeeklyOverview` is scoped by **(tenantId, userId)** exactly like every other repository method (never by planId alone), and it takes the **target week start** (the displayed Monday) so navigation can request any week. Its signature becomes `getWeeklyOverview({ tenantId, userId, weekStart })`; the current plan is resolved server-side (latest `ready` plan) to source the planned overlay — `planId` is not a client-supplied scope key.

**"done" counts by calendar week regardless of plan version.** The board is about *the user's week*, so a day counts as done from any completed session in that calendar week, even if it was logged against an older plan version or a since-regenerated plan. Completion is never filtered by which plan produced the session.

**Weeks predating the plan or the account.** Navigating to a week before the current plan existed (or before the account existed) shows a valid empty board: every day renders as **rest** (no planned overlay to place) except any day that actually has a completed session that week, which still shows **done** from its real `completedAt`. We never fabricate soon/active/planned statuses for weeks with no applicable plan, and we never error — an all-rest (or done-only) week is the correct empty state.

### Timezone: fixed UTC reference for all calendar bucketing (v1)

Every surface here draws calendar-day and calendar-week boundaries, and those boundaries need a fixed reference. There is **no per-user timezone column** in the model today. **Decision for v1: all calendar-day and calendar-week bucketing is computed in a single fixed timezone — UTC.** This applies uniformly to the streak (day boundaries), weekly progress / adherence (week boundaries), and the weekly board (both day and week boundaries): a "day" is a UTC calendar day, and a "week" is Monday 00:00 UTC through the following Sunday 23:59:59.999 UTC. Using one reference everywhere guarantees the three surfaces agree with each other for the same session data.

This is a **known limitation**: a user in a non-UTC timezone whose session crosses local midnight may see it bucketed into the adjacent UTC day, which can shift a streak edge or a board day by one. It is acceptable for v1 and consistent across all surfaces. **Future enhancement:** add a per-user timezone (profile column) and pass it into the bucketing functions so day/week boundaries follow the user's local time; the pure domain functions should already accept the reference as a parameter (default UTC) so this later change is non-breaking.

### Streak: consecutive training days

`computeStreak` counts the **consecutive calendar days**, ending today (or yesterday), on which the user completed at least one workout session. A calendar day with no completed session breaks the streak. This matches the dashboard's "Racha activa" 7-bar day sparkline. The `DashboardSummaryDTO` carries both the integer streak value and a recent per-day completion series for that sparkline.

We rejected defining the streak as consecutive 100%-adherence plan-weeks: the dashboard renders a per-day streak, not a per-week one. Day-streak is also derivable directly from `workout_sessions.completedAt` grouped by calendar day.

### Adherence lives on the Dashboard, not Statistics

Adherence — completed sessions vs. planned sessions for the current calendar week — is shown on the **Dashboard** as "Progreso semanal X/Y". The Statistics surface carries **no** adherence KPI. Concretely, `DashboardSummaryDTO` carries `weeklyCompleted` and `weeklyPlanned`, while `StatsSummaryDTO` has no adherence field. This placement follows the designs directly: `web-dashboard.html` shows "Progreso semanal" and `web-stats.html` shows no adherence KPI.

### Personal records: estimated 1RM

The personal record we display is the **estimated one-rep max (1RM)** per exercise (keyed on normalized `title`), matching the `web-stats.html` PR table ("1RM estimado" · Ejercicio · 1RM · Fecha · Tendencia).

We compute estimated 1RM with the **Epley formula**: `weightKg × (1 + reps / 30)`, taken over the best set across completed sessions. Each `PersonalRecord` exposes the estimated 1RM value, its `achievedAt` date, and a `trend` (a recent 1RM series plus a signed `delta`) for the sparkline. Max weight and max volume may be computed internally where useful, but they are **not** the displayed PR metric. Epley is derivable from `set_records` (weight + reps) with a single cross-session group-by and needs no new columns.

**Eligible-set guard.** An estimated-1RM PR considers **only sets where `completed = true` AND `weightKg` is non-null and `> 0` AND `actualReps` is non-null and `> 0`.** Bodyweight sets, no-weight/assisted sets, and sets with null reps are **excluded** from 1RM PRs — Epley is meaningless without a real load and rep count, and including them would surface spurious or zero PRs. Exercises that never have an eligible set produce no PR row (they are omitted, not shown as 0). A dedicated bodyweight/reps-only PR metric is out of scope for v1. PRs are grouped per exercise by the **normalized title** defined above (with the same synonym-fragmentation limitation).

### Muscle-group distribution: how it's aggregated vs. how it's shown

The distribution is drawn as a **horizontal bar chart**, as dictated by `web-stats.html` ("Series por grupo muscular" renders `.bar-chart` horizontal bars with a numeric count per row). It is not a donut and not a body-map. The donut on that screen is the separate "Distribución de entrenamientos" by workout *type*, which we do not track and which is out of scope.

There are two granularities, and they are deliberately different:

- The **domain and DTO always aggregate over the 10 primary `MuscleGroup` buckets** (the settled taxonomy, and the spec requirement).
- The **UI displays a coarser grouping** — roughly six buckets as `web-stats.html` shows: Espalda; Pierna (= quads + hamstrings + calves + glutes); Pecho; Hombro; Brazo (= biceps + triceps); and Core. This collapse is a pure presentation mapping (`MuscleGroup → display group`) that lives in the web layer only. The domain stays 10-group; the collapse is display-only.

The distribution metric shown in the bars is **set count per group** (the design frames it in sets). Our contract also carries per-group volume, so both are available; the bar chart defaults to the design's set-count framing. Labels come from `progress.muscle.<slug>` i18n keys.

### KPI deltas: null when the previous period is empty

Each `StatsSummaryDTO` KPI (total volume, session count, total duration, PR count) carries a `deltaVsPreviousPeriod`. When the **previous period has zero sessions / zero volume** (a new user, or a first-ever period), the delta is **`null`** — meaning "new / no comparison" — never `Infinity`, `NaN`, or a divide-by-zero error. The pure delta function guards the denominator: if the previous value is `0` (or absent) it returns `null`, and the UI renders that as a neutral "new" state (no up/down arrow) rather than a percentage. This applies to every delta the DTO exposes, including per-PR trend deltas where the prior data point is missing.

### Read model boundary: one bounded query per surface

We add a `ProgressRepository` (or equivalent methods on `WorkoutSessionRepository`) with bounded, batch-fetch queries — one purpose-built query per read need, with no N+1:

- `getDashboardSummary({ tenantId, userId })`
- `getStatsRange({ tenantId, userId, range })`
- `getWeeklyOverview({ tenantId, userId, weekStart })`
- `getExerciseDetail({ tenantId, userId, title })`

The dashboard's recent-N sessions reuse 09b's `listCompletedSessions` directly. We rejected a single "progress snapshot" endpoint: it would couple three independent surfaces and produce an unbounded payload. One query family per read need keeps each surface independently testable and cacheable, keeps the query count bounded, and matches 09b's approach.

**Tenant/user scoping (no IDOR).** All four new progress queries filter by **(tenantId, userId)**, exactly like the existing repository methods — the tenant/user pair comes from the authenticated session, never from client input, and it is part of every `WHERE` clause (including the joins down to `session_exercises` / `set_records`). This is called out specifically for **`getExerciseDetail({ tenantId, userId, title })`**: `title` is free-text supplied by the caller and is used only as an *additional* filter inside the already-(tenantId, userId)-scoped set of the user's own sessions — it can never widen the scope to another user's or tenant's data. Integration tests assert that a request scoped to one user cannot read another user's rows via any of these queries, including via a crafted `title`.

## File changes

The table below lists every file this change touches and what happens to it.

| File | Action | Description |
|---|---|---|
| `packages/contracts/src/index.ts` | Modify | Add `MuscleGroup` / `MUSCLE_GROUPS` / `MuscleRegion`; **create `PersonalRecord`** (it does not exist in contracts today) with the estimated-1RM value, `achievedAt`, `trend` + signed `delta`; add `DashboardSummaryDTO` (streak, weekly completed/planned, recent series), `StatsSummaryDTO`, `WeeklyOverviewDTO`, `ExerciseDetailDTO`. **`StatsSummaryDTO` must carry:** the KPIs `totalVolumeKg`, `sessionCount`, `totalDurationMin`, `prCount` — each with a `deltaVsPreviousPeriod`; a `volumeTrend` series (current + previous period) for the line chart; `muscleGroupDistribution` (per-group set count + volume); `personalRecords[]` with trend/delta; and `range` (week/month/year). |
| `packages/domain/src/progress/*` | Create | Pure functions, each with a single stated consumer: `classifyExerciseMuscleGroup` (write-time + backfill classification); `computeStreak` (dashboard streak); `computeAdherence` (dashboard weekly progress X/Y — completed vs. planned count); `computeWeeklyPlanVsCompletion` (weekly board per-day status array — done/active/rest/soon); `computeWeeklyRollup` (dashboard "Ruta de carga" per-day load/volume bars); `computeMuscleGroupDistribution` and `computePersonalRecords` (statistics). Plus an `index.ts` barrel. `computeAdherence`, `computeWeeklyPlanVsCompletion`, and `computeWeeklyRollup` are three distinct functions with three distinct consumers — not duplicates. |
| `packages/domain/package.json` | Modify | Add the `./progress` export as a subpath (NOT via the root barrel). |
| `apps/api/src/db/schema.ts` | Modify | Add the additive nullable `muscle_group` column on `session_exercises` plus the drizzle migration; update the `session_exercises` doc comment to "immutable except the derived `muscle_group` classification column". |
| `apps/api/src/db/repositories/workout-session.ts` | Modify | Populate `muscle_group` inside `insertSessionExercises`; add the new bounded progress queries. |
| `apps/api/src/db/` backfill script | Create | The idempotent muscle-group backfill. |
| `apps/api/src/routes/progress.ts` | Create | Thin `/progress/*` routes. |
| `apps/web/.../dashboard/page.tsx`, `stats/page.tsx`, `exercises/page.tsx` | Modify | Turn the current scaffolds into data-backed pages, built to the OpenDesign screens. |
| `apps/web/.../plan/PlanWeekView.tsx` | Modify | Monday–Sunday calendar board with prev/next week navigation; day states done/active/rest/soon; the 10→coarse presentation muscle-group mapping if shared. |
| `packages/i18n/src/messages/{en,es}.json` | Modify | Progress copy plus `progress.muscle.<slug>` labels (ES mirrors the manifest labels). |

## UI source mapping (OpenDesign kiNorA)

The UI is built from the OpenDesign kiNorA screens. The mapping below (reconciled 2026-07-17 against the current designs) says which screen backs each surface. Implementation must pull the actual HTML through the OpenDesign MCP so the pages match the design faithfully.

| Surface | Screen | Status |
|---|---|---|
| Dashboard | `screens/web-dashboard.html` | Present (updated 2026-07-17) |
| Statistics | `screens/web-stats.html` | Present (not re-updated; 2026-06-24) |
| Weekly overview | `screens/web-plan.html` ("Mi plan" / Plan semanal) | Present (now exists — no longer a blocker) |
| Exercise detail | `screens/mobile-exercise.html` (reference); `screens/muscle-library.html` (taxonomy source, not a history view) | Partial — no dedicated web exercise-history design |

Design tokens come from `assets/kinora.css` (the inline token system in `web-stats.html` is identical). The muscle imagery is 44 PNG assets (22 slugs × male/female) enumerated in `assets/kinora-muscles/library-manifest.json`.

The tokens and classes we reuse:

- **Colors**: `--bg` near-black `oklch(5% .006 270)`, `--surface` / `--surface-2`, `--border`, `--fg`, `--muted`, a single lime accent `--accent oklch(89% .20 128)` with `--accent-fg` / `--accent-dim`; state colors `--success` (= accent), `--warning`, `--danger`, `--info`. The design is dark-only, and the accent is used at most about twice per screen.
- **Type**: `--font-display` Space Grotesk for headings and all numerics (via `.num` / tabular-nums), `--font-body` DM Sans. Radii: card 18–22px, button 12–14px, pill 999px.
- **Chart and stat primitives already in `web-stats.html`**: `.kpi-card` (label + big `.num` value + `.kpi-delta pos/neg`); `.chart-card` (inline-SVG area/line); the horizontal-bar set `.bar-chart` / `.bar-row` / `.bar-track` / `.bar-fill` / `.bar-val`; the donut as an inline SVG `stroke-dasharray`; `.dist-list` / `.dist-row` legend; `.pr-table` (Ejercicio / metric / Fecha / Tendencia sparkline); and `.range-pills` for the Semana/Mes/Año period toggle.

## Testing strategy

We test at three layers, matching the one-directional data flow.

| Layer | What | Approach |
|---|---|---|
| Unit | Every pure function in `progress/` plus the classifier | Vitest, with fixtures per bucket and per edge case (null group, no data, tied streak) |
| Integration | The progress repository queries and routes | Assert the bounded query count, tenant scoping, and empty-state behavior |
| Component | The Dashboard, Statistics, Weekly, and Exercise pages | Data render plus guiding empty states, in both EN and ES |

## Migration and rollout

The `muscle_group` column is additive and nullable, so reverting is just dropping it with no data loss. The backfill is idempotent and re-runnable. Each surface is an independently removable query-plus-page unit. When the taxonomy is absent for an exercise, the distribution degrades to "no distribution" rather than erroring.

## Delivery slices

The work is delivered in **seven chained slices** (each within the 400-line review budget; final slicing done by sdd-tasks). The ask-on-risk delivery gate was resolved with the user by splitting the two heaviest concerns — Foundation (→ 1a/1b) and Statistics (→ 3a/3b) — and the Weekly work (→ 4a/4b), so no single PR exceeds ~400 lines and each carries one cohesive concern:

1a. **Contracts + classifier + subpath** — `MuscleGroup`/`MUSCLE_GROUPS`/`MuscleRegion`, the new DTOs (create `PersonalRecord`), the bilingual EN/ES classifier, and the `@kinora/domain/progress` subpath scaffold. Pure + type-level, no schema.
1b. **Schema + backfill** — additive nullable `muscle_group` column + migration + write-time populate + idempotent batched backfill (with reclassify path) + the immutable-table comment carve-out. Bases on 1a (needs its classifier + `MuscleGroup`).
2. **Dashboard** — its summary query + `computeStreak`/`computeAdherence`/`computeWeeklyRollup` + DTO + route + page, built to `web-dashboard.html`.
3a. **Statistics — KPIs** — `getStatsRange` + KPIs with period deltas + volume trend + page shell, built to `web-stats.html`.
3b. **Statistics — distribution + PRs** — `computeMuscleGroupDistribution` (10→coarse bar) + `computePersonalRecords` (Epley 1RM) wired into the stats page. Needs 1b's `muscle_group` column.
4. **Weekly board + exercise detail** — split into two chained sub-slices, both part of 09c and delivered in order:

   - **4a — Visual realignment (absorbs issue #128).** Realign the plan-view screen (`PlanWeekView`, `DayDetailPanel`, `plan/[id]/…`) to the current OpenDesign `web-plan.html` design: layout, spacing, tokens, component structure. This is a visual/structural pass with **no new progress-data behavior** — it does not add day statuses, week navigation, or completion wiring. Issue #128 is closed when 4a ships. Isolating the pure UI realignment keeps its diff reviewable on its own and unblocks it because the weekly design (`web-plan.html`) now exists.
   - **4b — Weekly-progress data + exercise detail.** On top of 4a's realigned screen, add the weekly-progress behavior: the Monday–Sunday day states (done/active/rest/soon), previous/next week navigation, and the completed-vs-planned adherence wiring (`getWeeklyOverview` + `computeWeeklyPlanVsCompletion`), plus the read-only exercise-detail history reference. This is the data-and-behavior sub-slice; it depends on 4a being merged first so the two never touch `PlanWeekView`/`DayDetailPanel` in conflicting ways.

## Open questions

- **Classifier keyword coverage — RESOLVED.** Folded into the bilingual-classifier decision above: v1 accepts the null-degrade default (unmapped exercises stay null and drop out of the distribution while still counting toward volume/sessions/trends/PRs); we do **not** enforce a minimum coverage threshold.
- **Planned-day → weekday placement — NEEDS PRODUCT DECISION** (see "Planned-day → weekday mapping"). v1 ships the deterministic Monday-first sequential fill as an advisory display convention; the authoritative "done" status is always driven by real `completedAt` dates. A future change may add real per-user training-weekday scheduling. This does not block task-cutting for 09c.

## Resolved decisions (reconciled 2026-07-17 against OpenDesign — design is source of truth)

- **Week model** = calendar week (Mon–Sun) with prev/next navigation; states done/active/rest/soon (no "missed"). See "The week model".
- **Streak** = consecutive calendar training days. See "Streak".
- **PR metric** = estimated 1RM (Epley) + trend + delta. See "Personal records".
- **Distribution granularity** = domain aggregates the 10 primary groups; the UI collapses to coarser buckets via a presentation mapping. See "Muscle-group distribution".
- **Adherence placement** = Dashboard "Progreso semanal X/Y"; not a Statistics KPI. See "Adherence lives on the Dashboard".
- **Weekday mapping** = `weeklySessions[].day` is a sequential plan-day index, not a weekday; "done" is driven by real `completedAt` dates, the planned overlay uses a deterministic Monday-first sequential fill (advisory; ⚠️ product decision for real scheduling). See "Planned-day → weekday mapping".
- **Timezone** = all calendar day/week bucketing (streak, weekly progress, weekly board) uses a single fixed **UTC** reference for v1; per-user timezone is a future enhancement. See "Timezone".
- **1RM eligibility** = estimated-1RM PRs consider only sets with `completed = true`, `weightKg > 0`, and `actualReps > 0`; bodyweight/no-weight/null-reps sets excluded. See "Personal records".
- **Title normalization** = trim + lowercase + collapse whitespace + strip diacritics, shared by classifier cache and PR grouping; does not merge synonyms (documented limitation). See "Title normalization".
- **Bilingual classifier** = keyword sets in EN and ES (Spanish seeded from the manifest labels); unmapped titles degrade to null. See "Bilingual classifier".
- **Immutable-table carve-out** = `muscle_group` is derived classification metadata, so write/backfill does not violate the `session_exercises` snapshot invariant ("immutable except the derived classification column"). See "Immutable-table carve-out".
- **Tenant/user scoping** = all four progress queries filter by (tenantId, userId); `getExerciseDetail` title is a filter, never a scope key (no IDOR). See "Read model boundary".
- **KPI deltas** = null ("new") when the previous period is empty; never divide-by-zero. See "KPI deltas".
- **Backfill robustness** = batched/chunked, idempotent, with a versioned reclassify path for future classifier improvements. See "How exercises get a muscle group".
- **Seven chained slices** = 1a (contracts+classifier+subpath) → 1b (schema+backfill) → 2 (Dashboard) → 3a (stats KPIs) → 3b (stats distribution+PRs) → 4a (visual realignment, absorbs #128) → 4b (weekly-progress data + exercise detail). Foundation and Statistics were each split to stay under the 400-line review budget. See "Delivery slices".
