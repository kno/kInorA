# Tasks: 17d — Plan Management

Implements `openspec/changes/17d-plan-management/specs/plan-management/spec.md` (11 requirements, 21
scenarios) plus the MODIFIED/ADDED deltas on `09b-plan-view` (2 requirements), `09a-v1-workout-tracking-core`
(2 requirements), and `06-v1-mobile-foundation` (1 requirement) — 16 requirements, 30 scenarios total —
under `design.md`'s HOW and the nine pinned decisions of `proposal.md` (plus its RESOLVED question
round). `design.md`'s **"Corrections to the proposal"** table wins over the proposal wherever they
differ; **`judgment-ledger.md`'s findings 1–5 are now requirements, not optional follow-ups** — findings
1 (optimistic concurrency), 2 (the `plan_specs` cascade widening), 3 (archived-plan deep-link
indicator), 4/5 (the ready-only edit gate, kept as defence-in-depth with its requirement now written
down) are each satisfied by a named task below, not left implicit.

Fixed slice order, do not resequence: **PR A → PR B → PR C → PR D**. Every implementation task is
preceded by its RED test task (Strict TDD). Tests ship in the same commit as the module they cover.

**The re-seam is real, task it as designed.** `plan_archived` AND `day_not_in_plan` both ship in **PR
B** (design's "PR boundary and re-forecast" — the proposal's original placement of `day_not_in_plan` in
PR D would touch the same fifteen `startSession` lines twice). PR D consumes both outcomes in its
integration test but adds no new `StartSessionOutcome` variant.

**The Open Design mockup (`screens/web-plans.html`) is the visual authority for PR A's list, and its
prototype state-switcher is explicitly OUT of scope** — it is throwaway scaffolding for viewing every
mock state at once, not product chrome. Do not implement a state-switcher control. The nav-entry gap
in that mockup (only `web-plans.html` shows the new entry; the other five static screens do not) is a
mockup limitation, not a spec — task A.11/A.12 wire the entry into the **shared** `SidebarNav`/
`MobileNav` components, which automatically propagates it to every real page in the app.

## Review Workload Forecast

`review_budget_lines: 800`, measured on **non-test** lines. `chain_strategy: stacked-to-main` — each
PR targets the previous PR's branch or `main` in sequence. `delivery_strategy: ask-on-risk` was already
exercised during propose/design: the product owner was told the total sits 1.09–1.65× the 800-line
non-test budget and chaining is mandatory, not a convenience. Not re-asked here.

Re-forecast from `design.md`'s corrected numbers (the re-seam moved `day_not_in_plan` into PR B, adding
~50 lines there and removing ~40 from PR D):

| PR | Content | Non-test | Test | 800-line budget risk |
|----|---------|----------|------|------------------------|
| A | `/plans` route + nav entry (2 arrays, 2 catalogs) + `listPlansWithProgress` + `?progress=1` + the `plan/page.tsx:36` fix | ~250–400 | ~280–430 | Low |
| B | Migration `0029`, `includeArchived` filter, archive/unarchive routes, **both** `startSession` refusals, contract variants, show-archived UI, archived-plan week-view indicator, widened no-DELETE guard | ~200–260 | ~230–340 | Low |
| C | Mobile plans list + archive (screen, client methods, nav entry) | ~150–250 | ~150–250 | Low |
| D | Edit: route + `validateEditedProgram` + editor UI + catalog reuse + tracker guard | ~270–410 | ~300–450 | Low |
| | **Total** | **~870–1320** | **~960–1470** | |

Every PR sits inside the 800-line non-test budget individually; the total is 1.09–1.65× it, unchanged
in character from the proposal's honest signal. Do not trim tests to fit a number — the split is on its
merits, per the design.

### Dependency diagram (for chained-PR tracking; mark the current PR with 📍)

```
PR A (/plans route + nav + progress query + swallowed-error fix)
 └─ PR B (archivedAt migration + filter + archive/unarchive + startSession refusals — needs A's list to hide plans from)
     └─ PR C (mobile list + archive, greenfield — scoped to exactly what A and B shipped)
         └─ PR D (edit the program, web only — largest slice, ships last per pinned decision 4)
```

## Repo gotchas carried into task notes (do not re-derive)

- **The migration journal hand-check is directory-driven, not retired-but-manual-in-a-different-way.**
  `apps/api/src/db/__tests__/migration-journal.test.ts` reads `apps/api/drizzle/*.sql` and
  `_journal.json` from disk; the general contiguous-`idx`/matching-`tag` assertions cover a new
  migration with no edit. The **only** manual step is picking the right `idx`: **journal max is
  currently 28** (`0028_user_weight_entries` — verified at `_journal.json:202-206`), so this change's
  entry is `idx: 29`. **`drizzle/` holds 29 `.sql` files, not 28** — `0011` is used twice
  (`0011_billing_plans_tiers.sql` and `0011_abnormal_squadron_sinister.sql`). Deriving the number from
  the file count would produce `0030` and leave a gap; the journal, not the directory, is authoritative.
- **apps/api function coverage headroom is ~0.5 points (85.51% after #392).** Every new API function —
  six repo methods and four route handlers across this change — ships with its tests in the same
  commit. `validateEditedProgram` (PR D) lives in `packages/domain`, under the **global functions
  threshold of 100**, not apps/api's 85 — its test table must be exhaustive, not representative. Never
  `--no-verify` past a coverage-threshold failure.
- **The CI integration-suite list is a glob (#392), unlike 17c's hardcoded list.** A new
  `*.integration.test.ts` under `apps/api/src/db/repositories/__tests__/` is picked up automatically by
  the real-Postgres job, and a guard fails the job if a suite on disk was never invoked
  (`ci-cd.yml:113-144`). **No workflow edit needed** for PR B's or PR D's new integration suites.
- **i18n dist staleness.** Apps resolve `@kinora/i18n` through built `dist/`, not `src`. Editing the
  catalogs (PR A, B, D) without rebuilding (`pnpm build`) silently serves stale messages.
- **`packages/i18n` carries a canary test asserting an exact leaf-key count.** Every catalog addition in
  PR A/B/D must bump it in the same commit.
- **Mobile resolves the SAME shared `@kinora/i18n` catalog via `react-intl`, not a separate mechanism**
  (unlike 17c's precedent, where mobile had its own per-screen `messages.ts`). PR C's
  `apps/mobile/src/screens/plans/messages.ts` is id-only `defineMessages` pointing at the `plans.*` keys
  PRs A and B already authored — PR C adds **no** new catalog key and must check for an existing key
  before reaching for a new one.
- **`.kin-btn--primary` does not exist in `globals.css`** — only `--accent`, `--danger`, `--ghost`. It
  renders transparent everywhere it is used. **Do not introduce a new use of `.kin-btn--primary` in this
  change**; use `--accent` for the primary action styling the Open Design mock calls for. The global
  fix is a separate, out-of-scope concern.
- **`MobileNav.PRIMARY_TABS` cannot take a fourth entry** without a layout change (`PRIMARY_TABS.slice(0,
  2)` + FAB + `.slice(2)` + More button, `MobileNav.tsx:128-169`). `/plans` goes in `SECONDARY_TABS`
  (the More menu), verified at `MobileNav.tsx:27-31`.
- **`SidebarNav.NAV_ITEMS`/`MobileNav.{PRIMARY_TABS,SECONDARY_TABS}` are shared components** rendered by
  every authenticated page via `AppShell`. Editing them once in PR A propagates the `/plans` entry
  everywhere — there is no per-page nav to touch, unlike the Open Design static mockup's five
  unmodified screens.
- **`gh` auth**: pushing to `kno/kInorA` / opening or merging a PR requires
  `GH_TOKEN="$(gh auth token --user kno)" gh <cmd>` — never `gh auth switch`.
- **Coverage gates**, enforced by `.githooks/pre-push`: `pnpm -r --if-present test:coverage`, apps/api
  functions ≥85%, apps/web functions ≥90%. A threshold failure is deterministic and real — never
  `--no-verify` past it.

## Two open apply-time decisions, made explicit as tasks (not silent assumptions)

1. **PR A — the exact color tokens for last-trained-by-age.** The Open Design mock specifies "lime when
   recent, amber after weeks, dim grey after months" but names no CSS custom property.
   `globals.css` was not confirmed to carry `--success`/`--warning`/semantic age tokens during this
   phase. Task A.12 grep-confirms what exists and either reuses a matching token or defines new ones
   scoped to this page — it must NOT introduce a new `.kin-btn--primary`-style dead class.
2. **PR B — which surface renders the archived-plan week-view indicator.** `/plan?planId=X` resolves
   through `plan/page.tsx` → `PlanWeekView`. Task B.11 confirms `PlanWeekView` is the only render path
   for that deep link (as opposed to `plan/[id]/PlanStatusClient.tsx`, which serves the live-generation
   view) before adding the `archivedAt` prop, so the indicator is not duplicated or missed.

---

## Phase PR A: Plans List Surface

Start state: no `/plans` route exists; `/plan`'s nav item is the only way to reach a plan; `findAllByUser`
returns `{ id, status, createdAt, name }` only; `plan/page.tsx:36` reduces a failed
`listPlansAction()` to `[]`. End state: a `/plans` route reachable from `SidebarNav`/`MobileNav`,
listing every plan (no archive filter yet — that is PR B) with days-per-week, completed-session-count
and last-trained-date, produced in exactly three queries; a distinguishable error state on fetch
failure, both on `/plans` and on the pre-existing `/plan` page. Rollback boundary: the route and nav
entry are additive; reverting them returns the user to `/plan`'s selector. **Keep the
`plan/page.tsx:36` fix if the rest of PR A is reverted** — it is strictly a correctness improvement to
an existing page.

Satisfies: Plans List Surface; Plans List Distinguishes A Load Failure From An Empty List;
`09b-plan-view` List Endpoint Returns Progress Fields And Excludes Archived Plans (MODIFIED — progress
half only; the archived-filter half is PR B's); `09b-plan-view` /plan Page Distinguishes A Load Failure
From An Empty List (MODIFIED).

### Contracts: progress fields

- [x] A.1 RED: extend `packages/contracts/src/contracts.test.ts`'s exact-shape assertion for
      `WorkoutPlanSummary` (`:318-319`, `toEqualTypeOf`) to include the three new optional fields; add a
      compile-time check that `daysPerWeek?: number`, `completedSessions?: number`, and
      `lastTrainedAt?: string` are all optional and absent by default
- [x] A.2 GREEN: in `packages/contracts/src/index.ts` — add `daysPerWeek?: number`,
      `completedSessions?: number`, `lastTrainedAt?: string` to `WorkoutPlanSummary`, each documented as
      "`?progress=1` only, absent when unknown — never 0/never a fabricated date"; confirm A.1 is green
      and the runtime export-list assertion (`:61-72`) stays unedited (every addition is type-only)

### Repository: the three-query progress read

- [x] A.3 RED: `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` — `listPlansWithProgress`:
      exactly three queries execute for N plans regardless of N (spy on the db, assert call count
      invariant to N — the anti-N+1 acceptance criterion); zero plans → **one** query, no further reads;
      a plan with no sessions → `completedSessions: 0`, `lastTrainedAt` absent (not `null`); a missing
      `plan_specs` row → `daysPerWeek` absent, not `0`; a malformed/legacy `spec_json.daysPerWeek` (not
      a positive finite number) → `daysPerWeek` absent; ordering matches `findAllByUser`'s
      newest-first
- [x] A.4 GREEN: in `apps/api/src/db/repositories/workout-plan.ts` — add
      `WorkoutPlanProgressSummary extends WorkoutPlanSummary { daysPerWeek?, completedSessions,
      lastTrainedAt? }` and `listPlansWithProgress(tenantId, userId): Promise<WorkoutPlanProgressSummary[]>`
      per `design.md`'s three-query shape: Q1 mirrors `findAllByUser`'s select plus `planSpecId`
      (short-circuits with **no** further query when `[]`, following `listSessionHistory:853`'s guard);
      Q2 `select({ id, specJson }).from(planSpecs).where(inArray(planSpecs.id, specIds))`, reading
      `daysPerWeek` in TS (`typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined`); Q3
      one `GROUP BY workout_plan_id` aggregate over `workout_sessions`, gated on
      `status = 'completed'`, using `COALESCE(completed_at, started_at)` for `lastTrainedAt` (matches
      `listSessionHistory:849`'s ordering expression); **do not add `includeArchived` yet** — the
      column does not exist until PR B; confirm A.3 is green

### Route: `?progress=1`

- [x] A.5 RED: `apps/api/src/routes/__tests__/plan-generation.test.ts` (or a new
      `plan-list-progress.test.ts` alongside it) — `GET /workout-plans?progress=1` returns the three
      extra fields per plan; `GET /workout-plans` **without** the param is byte-identical to today's
      response (same fields, same order); 401 unauthenticated; cross-tenant/cross-user isolation holds
      for the progress path too
- [x] A.6 GREEN: in `apps/api/src/routes/plan.ts`'s `GET /workout-plans` handler — read the `progress`
      query param; when truthy call `repo.listPlansWithProgress` (a new optional method on
      `PlanRouteRepo`) and map the three extra fields onto the response array; otherwise call the
      existing `findAllPlansByUser` unchanged; in `apps/api/src/plan-route-repo.ts` wire
      `listPlansWithProgress` from `workoutPlanRepo.listPlansWithProgress`, applying the same
      `defaultPlanName(row.name, row.createdAt)` resolution `findAllPlansByUser` already applies;
      confirm A.5 is green

### The `/plans` page

- [x] A.7 RED: RTL + jsdom component/page test for a new
      `apps/web/src/app/(app)/plans/__tests__/page.test.tsx` — renders every plan with its days/week,
      completed-session-count and last-trained date; a plan never trained shows "never trained" copy,
      not a fabricated date; **a failed list fetch renders a distinguishable error state
      (`role="alert"`)**, never the empty-account state; zero plans renders the empty state with a
      create-plan CTA
- [x] A.8 GREEN: create `apps/web/src/app/(app)/plans/{page.tsx,actions.ts,plans-client.ts,PlanList.tsx}`
      — `actions.ts` calls `GET /workout-plans?progress=1`; `page.tsx` distinguishes the three states
      (ok-with-plans / ok-empty / fetch-failed) explicitly rather than collapsing failure into `[]`
      (the exact anti-pattern PR A's `/plan` fix below closes); `PlanList.tsx` renders per the Open
      Design mock: the plan currently being followed (per `findLatestReadyByOwner`'s "latest ready"
      notion, adapted to the caller's own list) spans two columns with a "Siguiendo ahora" /
      "Currently following" badge, distinct from the rest of the grid; confirm A.7 is green
- [x] A.9 RED: extend A.7's suite — `generating` and `failed` plans render real bodies (not blank
      cards) with their existing status copy; any action button that cannot apply to a `generating` or
      `failed` row (e.g. a future edit affordance) is `disabled` **and** `aria-disabled="true"` **and**
      carries an explanatory `title`, per the Open Design mock's blocked-button contract
- [x] A.10 GREEN: extend `PlanList.tsx` per A.9; **do not implement the Open Design mock's
      state-switcher control** — it is prototype scaffolding, not product chrome; confirm A.9 is green

### Nav entry (shared components — propagates to every page)

- [x] A.11 RED: extend `apps/web/src/components/AppShell/__tests__/SidebarNav.test.tsx` and
      `MobileNav.test.tsx` (read both files first — their exact assertions were not confirmed during
      design) — `SidebarNav.NAV_ITEMS` renders a `/plans` entry; `MobileNav.SECONDARY_TABS` (the More
      menu, **not** `PRIMARY_TABS` — verified `PRIMARY_TABS.slice(0,2)` + FAB + `.slice(2)` layout
      cannot take a fourth primary tab) renders a `/plans` entry; the bottom bar still renders exactly
      three primary tabs plus the FAB and the More button
- [x] A.12 GREEN: add `{ labelKey: "appNav.plans", href: "/plans", icon: "plan" }` (or a distinct icon —
      grep `@/components/icons` for one that reads as "list of plans" rather than reusing `PlanIcon`
      unmodified, to avoid two adjacent identical icons) to `SidebarNav.NAV_ITEMS` and to
      `MobileNav.SECONDARY_TABS`; confirm A.11 is green
- [x] A.13 GREEN, same commit as A.10: implement the last-trained age color-coding — grep
      `apps/web/src/app/globals.css` for existing semantic tokens (`--success`/`--warning`/similar)
      before introducing new ones; wire "recent" (≤7 days), "aging" (≤30 days), "stale" (>30 days) to
      three distinct visual treatments, never introducing a new `.kin-btn--primary`-style class; a
      plan with no `lastTrainedAt` renders neutrally, not as "stale"

### `/plan` page: the swallowed-error fix (pinned decision 7)

- [x] A.14 RED: extend `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` (or create it if absent) —
      a failed `listPlansAction()` renders a distinguishable error state, not the same empty-account UI
      a genuinely-zero-plans user sees; a genuinely empty account still renders the empty state with
      its create-plan CTA; `?planId=<owned-id>` deep links still resolve unaffected
- [x] A.15 GREEN: in `apps/web/src/app/(app)/plan/page.tsx:36` — replace
      `listResult.kind === "ok" ? listResult.plans : []` with an explicit branch that renders the error
      state on `listResult.kind !== "ok"` instead of falling through to the empty-account render;
      confirm A.14 is green

### i18n

- [x] A.16 GREEN: add `appNav.plans`, `plans.list.*` (days-per-week/completed/last-trained/never-trained
      copy, currently-following badge, generating/failed body copy, error-state copy), and
      `plan.nav.loadError.*` to `packages/i18n/src/messages/{en,es}.json`, both locales, neutral
      professional register; bump the leaf-key-count canary test in the same commit; rebuild
      `packages/i18n` (`pnpm build`) before manual verification

### PR A verification

- [x] A.17 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green (apps/api functions
      ≥85%, apps/web functions ≥90%); `pnpm type-check` clean; `pnpm build` succeeds (confirms
      `packages/i18n` rebuild)

---

## Phase PR B: Archive — column, filter, refusals

Start state: `workout_plans` has no archive concept; `findAllByUser`/`listPlansWithProgress` return
every plan regardless of status; `startSession` has no archived-plan or removed-day refusal; no
guard asserts the absence of a `plan_specs` DELETE route. End state: a nullable `archived_at` column,
`includeArchived` opt-in on both list methods (defaulting to the filtered behaviour), idempotent
archive/unarchive routes, `startSession`'s two typed Phase-2 refusals (`plan_archived`,
`day_not_in_plan`), a show-archived UI section on `/plans`, an archived-plan indicator on the
`/plan?planId=X` week view, and the widened no-DELETE guard naming `plan_specs` explicitly. Rollback
boundary: revert the routes/UI **before** dropping the column, or `findAllByUser` queries a missing
column; after the drop every plan is visible again with zero data loss, because archive never deleted
anything; the `startSession` refusals revert with the code.

Satisfies: No Delete Route For Plans, Nor For Anything That Cascades Into Them (Judgment Day finding 2,
corrected); Archive Toggles Visibility Without Losing History; An Archived Plan's Week View Indicates
It Is Archived (Judgment Day finding 3, corrected); Archive Is Reversible; `09b-plan-view` List
Endpoint Returns Progress Fields And Excludes Archived Plans (MODIFIED — archived-filter half);
`09a-v1-workout-tracking-core` Workout Session Recording (MODIFIED — archived refusal); the
day-removal half of "An Edited Program Keeps At Least One Session And No Dangling Day" (the refusal
plumbing; the edit that makes a removed day *reachable* is PR D's).

### Migration + guard

- [ ] B.1 Preflight: grep `apps/api/drizzle/meta/_journal.json`, confirm the current highest `idx` is
      28, so the new entry is `idx: 29` with no gap — **the SQL filename count is 29, not 28, because
      `0011` is duplicated; the journal `idx`, not the file count, is authoritative**
- [ ] B.2 RED: extend `apps/api/src/db/__tests__/migration-journal.test.ts` with a pinning assertion
      that `0029_workout_plan_archived_at.sql` exists at `idx: 29` (the general contiguous-`idx`/
      matching-`tag` assertions already cover it with no edit)
- [ ] B.3 GREEN: create `apps/api/drizzle/0029_workout_plan_archived_at.sql` —
      `ALTER TABLE "workout_plans" ADD COLUMN "archived_at" timestamp with time zone;`; hand-add the
      journal entry `{ idx: 29, version: "7", when: <ms>, tag: "0029_workout_plan_archived_at",
      breakpoints: true }`; add `archivedAt: timestamp("archived_at", { withTimezone: true })` to
      `workoutPlans` in `apps/api/src/db/schema.ts:649-...`, documenting it as orthogonal to `status`
      (a plan may be `failed` and archived at once) and additive/nullable like `name`; confirm B.2 is
      green

### Contracts: archive + refusal variants

- [ ] B.4 RED: extend `contracts.test.ts`'s exact-shape assertion for `WorkoutPlanSummary` to add
      `archivedAt?: string | null`; extend the `StartSessionOutcome` union assertion (`:210-266`) with
      `{ kind: "plan_archived" }` and `{ kind: "day_not_in_plan"; availableDays: number[] }`; add
      compile-time checks for `PlanArchiveResponse { id, archivedAt }`
- [ ] B.5 GREEN: in `packages/contracts/src/index.ts` — add the fields/variants/types from B.4; confirm
      B.4 is green and the runtime export-list assertion (`:61-72`) stays unedited (type-only additions)

### Repository: the filter + `setArchived`

- [ ] B.6 RED: `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` — `findAllByUser` hides
      archived plans by default and returns them with `includeArchived: true`; `listPlansWithProgress`
      gains the identical option and behavior; `setArchived` is idempotent (a second archive on an
      already-archived plan does not move `archivedAt`); `setArchived(false)` (unarchive) clears the
      column and is idempotent the same way; a cross-user/cross-tenant id resolves to `undefined`
      (404, not a leak)
- [ ] B.7 GREEN: in `apps/api/src/db/repositories/workout-plan.ts` — add `options: { includeArchived?:
      boolean } = {}` to both `findAllByUser` and `listPlansWithProgress`, appending
      `archived_at IS NULL` to the existing `and(...)` unless `includeArchived` is true; add
      `WorkoutPlanSummary.archivedAt: Date | null` to the summary projection; add
      `setArchived(tenantId, userId, id, archived): Promise<{ id, archivedAt } | undefined>` using
      `COALESCE(archived_at, now())` on the archive path so a repeat archive cannot move the timestamp,
      scoped by tenant AND user; confirm B.6 is green

### `startSession`: the two typed refusals

- [ ] B.8 RED: `apps/api/src/db/repositories/__tests__/workout-session.test.ts` — `startSession` returns
      `{ kind: "plan_archived" }` for a **new** session against an archived plan; returns `{ kind:
      "resumed" }` for a session already in progress whose plan is archived mid-workout (the resume
      branch at Phase 1 must win over the Phase 2 archived check); `recordSet`/`completeSession`/
      `abandonSession` all succeed unchanged against an archived plan — the "does not stop someone
      mid-workout" criterion, asserted rather than argued; `startSession` returns `{ kind:
      "day_not_in_plan", availableDays: [...] }` (ascending) when the requested day is not in the
      program, distinct from the plan-not-found `undefined`
- [ ] B.9 GREEN: in `apps/api/src/db/repositories/workout-session.ts` — extend `findReadyPlan`'s select
      to include `archivedAt`; in `startSession`'s Phase 2 (`:393-402`, immediately after the resume
      branches and before the Phase 3 transaction), add: `if (plan.archivedAt !== null) return { kind:
      "plan_archived" }`; then, when no `plannedSession` matches the requested day, return `{ kind:
      "day_not_in_plan", availableDays: plan.programJson.weeklySessions.map(s => s.day).sort((a,b) =>
      a-b) }` instead of the current bare `undefined`; confirm B.8 is green
- [ ] B.10 GREEN: in `apps/api/src/routes/workout-session.ts` — map `plan_archived` to `409 { error:
      "plan_archived" }` and `day_not_in_plan` to `404 { error: "day_not_in_plan", availableDays }`
      (kept at 404, not 409, so both web `tracker-client.ts` and mobile `plan-status-client.ts`'s
      existing 404-branching in the offline flush taxonomy needs no status-code migration — only the
      body key changes); RED test in `apps/api/src/routes/__tests__/workout-session.test.ts` precedes
      this

### Archive/unarchive routes

- [ ] B.11 RED: `apps/api/src/routes/__tests__/plan-archive.test.ts` — `POST
      /workout-plans/:id/archive` returns `200 { id, archivedAt }`; a repeat call returns the same
      unchanged `archivedAt`; `POST /workout-plans/:id/unarchive` returns `200 { id, archivedAt: null }`,
      idempotent the same way; both 404 on another user's/tenant's plan (indistinguishable from a
      missing plan — no IDOR leak); 401 unauthenticated
- [ ] B.12 GREEN: in `apps/api/src/routes/plan.ts` — register `POST /workout-plans/:id/archive` and
      `/unarchive` calling `repo.setArchived` (new `PlanRouteRepo` method wired in
      `apps/api/src/plan-route-repo.ts`); confirm B.11 is green

### Integration + repo-wide guard

- [ ] B.13 RED then GREEN (integration, no production change beyond what B.7/B.9 already shipped):
      `apps/api/src/db/repositories/__tests__/workout-plan-archive.integration.test.ts` — archiving a
      plan with completed sessions destroys **zero** `workout_sessions` rows (count before == count
      after); unarchive restores default-list visibility exactly. Picked up automatically by the CI
      glob (#392) — no workflow edit
- [ ] B.14 RED then GREEN: widen the existing no-DELETE route-table guard (or add one alongside it if
      none exists yet) to assert the registered Fastify route table contains **no** `DELETE` method on
      any `/workout-plans*` **or** `/plan-specs*` path — Judgment Day finding 2: the original scope
      named only `workout_plans`, but `workout_plans.plan_spec_id` → `plan_specs.id` is
      `ON DELETE CASCADE` (`schema.ts:659-661`), so a future `DELETE /plan-specs/:id` would destroy
      every plan for that spec and all training history while never touching `/workout-plans*`. The
      guard's own comment states the full cascade chain (`plan_specs` → `workout_plans` →
      `workout_sessions` → `session_exercises` → `set_records`) so the reason travels with the assertion

### Show-archived UI + the archived-plan week-view indicator

- [ ] B.15 RED: extend `apps/web/src/app/(app)/plans/__tests__/page.test.tsx` — archived plans are
      excluded from the default `/plans` view; a show-archived toggle reveals them in their **own
      section below a separator**, not mixed into the active grid (per the Open Design mock); the
      archive action's confirmation copy states that history is preserved; unarchiving from the
      archived section moves a plan back into the default grid without a page reload
- [ ] B.16 GREEN: create/extend `apps/web/src/app/(app)/plans/{plans-client.ts,PlanRowActions.tsx}` —
      archive/unarchive buttons calling the B.12 routes; the show-archived section per B.15; confirm
      B.15 is green
- [ ] B.17 RED: extend `apps/web/src/app/(app)/plan/__tests__/page.test.tsx` (or `PlanWeekView`'s own
      test file) — an archived plan's week view visibly indicates it is archived when reached via
      `?planId=X`, while remaining fully reachable and functional (the deep link is unaffected by
      archiving — archiving controls list visibility, not URL reachability, per the corrected
      requirement)
- [ ] B.18 GREEN: confirm `PlanWeekView` (not `plan/[id]/PlanStatusClient.tsx`, which serves the
      live-generation view) is the render path for `/plan?planId=X`'s `ready` branch; add
      `archivedAt?: string | null` to `PlanWeekViewProps`, threaded from `GET /workout-plans/:id`'s
      response (which must now include `archivedAt` — extend that route handler and its DTO mapping);
      render a visible "archived" indicator when present; confirm B.17 is green

### i18n

- [ ] B.19 GREEN: add `plans.archive.*` (confirm copy, "history is preserved" copy, show-archived
      toggle label, section heading), `plan.archived.badge` to `packages/i18n/src/messages/{en,es}.json`,
      both locales; bump the leaf-key-count canary; rebuild before manual verification

### PR B verification

- [ ] B.20 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green; `pnpm type-check`
      clean; `pnpm build` succeeds
- [ ] B.21 Verify: grep-confirm the new `0029` migration entry and the `plan_specs` DELETE-route guard
      are both present, then re-read `_journal.json` to confirm `idx: 29` is contiguous with `idx: 28`

---

## Phase PR C: Mobile Plans List + Archive (Greenfield)

Start state: zero matches for a plans-list concept in `apps/mobile/src` — no tab bar, no plan-list
screen; `HomeScreen` resolves exactly one "current plan"; `App.tsx`'s `RootStackParamList`/
`PROTECTED_ROUTES` have no `Plans` entry. End state: a new plans-list screen reachable from
`HomeScreen`, listing every non-archived plan with the same fields and archive/unarchive semantics as
web, wired through `plan-status-client.ts` (not a new client module — that module already owns every
plan read on mobile). Rollback boundary: self-contained new screen, client methods, and one
`HomeScreen` entry button; revert in isolation, no other PR depends on it.

Satisfies: Mobile List And Archive Parity; `06-v1-mobile-foundation` Mobile Plans Navigation Entry
(ADDED).

### Mobile API client — extend, do not duplicate

- [x] C.1 RED: extend `apps/mobile/src/api/__tests__/plan-status-client.test.ts` — `fetchPlanList`
      returns the same progress fields web receives; `archivePlan`/`unarchivePlan` round-trip
      `{ id, archivedAt }`; a 401 sets `sessionExpired` (the existing `NO_SESSION` sentinel pattern);
      a 404 carries `status: 404`; no `tenantId`/`userId` appears in any request body (identity comes
      only from the bearer token, mirroring every other method in this file)
- [x] C.2 GREEN: in `apps/mobile/src/api/plan-status-client.ts` — add `fetchPlanList`, `archivePlan`,
      `unarchivePlan`, reusing `requestInit`/`mapError`/`NO_SESSION`/`apiBaseUrl` already in this file
      rather than a new `plan-list-client.ts`; confirm C.1 is green

### The plans screen

- [x] C.3 RED: RN component test — `apps/mobile/src/screens/plans/__tests__/PlansScreen.test.tsx` —
      renders every plan with days-per-week/completed/last-trained; archiving a row removes it from the
      list without a full screen reload; a show-archived affordance reveals archived rows; a load
      failure renders a distinguishable error state, not an empty list
- [x] C.4 GREEN: create `apps/mobile/src/screens/plans/{PlansScreen.tsx,PlansScreen.styles.ts,
      messages.ts}` — `messages.ts` is id-only `defineMessages` pointing at the **existing** `plans.*`
      keys PR A/B already authored (check `packages/i18n/src/messages/en.json` for the key before
      adding anything — this file adds **no** new catalog key); confirm C.3 is green

### Navigation wiring

- [x] C.5 RED: RN component test on `HomeScreen` — a "Plans" entry button is present and navigates to
      the `Plans` route; the existing "View your plan" entry into `PlanStatus` is unaffected
- [x] C.6 GREEN: in `apps/mobile/App.tsx` — add `Plans: undefined` to `RootStackParamList`, add
      `"Plans"` to `PROTECTED_ROUTES`, add a `<Stack.Screen name="Plans" component={PlansScreen} />`;
      in `apps/mobile/src/screens/HomeScreen.tsx` — add one entry `Pressable` beside the existing
      History/Profile buttons (`:205-221`), following that exact pattern; confirm C.5 is green

### PR C verification

- [x] C.7 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green; `pnpm type-check`
      clean; `pnpm build` succeeds

---

## Phase PR D: Edit The Program (Web Only)

Start state: `program_json` is written in exactly one place, `markReady`; there is no write path over
an existing plan's program; `tracker-model.ts` has zero `programJson` references (safe by construction,
unguarded). End state: `PUT /workout-plans/:id/program` — a full-document replace, `ready`-only,
optimistically concurrency-controlled on `updatedAt` (Judgment Day finding 1), server-resolving
`catalogId` via the reused `resolveProgramCatalogIds`, validated by a new pure `validateEditedProgram`
in `packages/domain`; a web editor UI; a guard test pinning the tracker's zero-`programJson` invariant;
an end-to-end integration proof that the next `startSession` after an edit reflects it, and that a
removed day resolves to `day_not_in_plan` (the outcome PR B already shipped). Rollback boundary: revert
the route, the client and the editor. Programs already edited stay edited — they are valid
`WorkoutProgram` documents by construction (passed `WorkoutProgramSchema` plus
`validateEditedProgram`), so nothing is corrupted; the user simply loses the ability to edit again.

Satisfies: Editing The Program; Editing Is Restricted To Ready Plans (Judgment Day findings 4/5 — the
requirement now exists, and its stated rationale is the structural one: `program_json` is `NULL` until
`markReady`, not a lost-update race that cannot occur); Concurrent Edits Are Detected, Not Silently
Overwritten (Judgment Day finding 1); An Edited Program Keeps At Least One Session And No Dangling Day
(the validation half — PR B already shipped the `day_not_in_plan` refusal this proves end-to-end); The
Next Session After An Edit Uses The Edited Program; `09a-v1-workout-tracking-core` Program Edits Never
Affect An In-Progress Session (ADDED).

### The pure validator

- [ ] D.1 RED: `packages/domain/src/plan/__tests__/edited-program.test.ts` — every branch of
      `validateEditedProgram`, exhaustively (this function falls under the global 100% functions
      threshold, not apps/api's 85%): zero sessions → `["empty_program"]`; two sessions claiming the
      same day → `["duplicate_day"]`; day `0` and day `8` → `["invalid_day"]` each; a day with zero
      exercises → `["empty_session"]`; multiple simultaneous issues all reported, in document order; a
      fully valid program → `[]`
- [ ] D.2 GREEN: create `packages/domain/src/plan/edited-program.ts` exporting
      `EditedProgramIssue = "empty_program" | "duplicate_day" | "invalid_day" | "empty_session"` and
      `validateEditedProgram(program: WorkoutProgram): EditedProgramIssue[]` — pure, total, no I/O, no
      throw; `invalid_day`'s bound (`1..7`) copied from the start route's own `day: { minimum: 1,
      maximum: 7 }` (`routes/workout-session.ts:107`); export from `packages/domain/src/index.ts`;
      confirm D.1 is green

### Contracts: the edit + conflict DTOs

- [ ] D.3 RED: extend `contracts.test.ts` — compile-time checks for `UpdatePlanProgramRequest { program,
      expectedUpdatedAt }`, `UpdatePlanProgramResponse { id, program, updatedAt }`, and
      `PlanEditConflictResponse { error: "edit_conflict"; currentUpdatedAt }`
- [ ] D.4 GREEN: add the three types from D.3 to `packages/contracts/src/index.ts`; confirm D.3 is green
      and the runtime export list is unedited

### Repository: `updateProgram`

- [ ] D.5 RED: `apps/api/src/db/repositories/__tests__/workout-plan.test.ts` — `updateProgram` succeeds
      only when `tenant + user + id` match, `status = 'ready'`, and `updated_at` equals the caller's
      `expectedUpdatedAt`; returns `undefined` on any mismatch (0 rows updated) without distinguishing
      the cause at this layer (disambiguation is the route's job, D.7); a successful call advances
      `updatedAt` past the submitted value
- [ ] D.6 GREEN: in `apps/api/src/db/repositories/workout-plan.ts` — add
      `updateProgram(tenantId, userId, id, program, expectedUpdatedAt): Promise<WorkoutPlanRecord |
      undefined>` conditioning the `UPDATE` on `tenant_id AND user_id AND id AND status='ready' AND
      updated_at=$expectedUpdatedAt`, `SET program_json, updated_at=now()`; confirm D.5 is green

### The route: seven ordered steps

- [ ] D.7 RED: `apps/api/src/routes/__tests__/plan-edit.test.ts` — a submitted `catalogId` never
      survives into what reaches the repository (asserted on the captured `updateProgram` call
      argument, not just the response — Zod's default object strip-by-default is the mechanism, and
      this test is what would fail if a global `.passthrough()` were ever introduced); the
      server-resolved `catalogId` is present instead; a submitted `limitationWarnings` array is
      ignored and the stored one survives unchanged; **404** on another user's/tenant's plan; **409
      `plan_not_ready`** on a `generating` or `failed` plan; **422** on a program failing
      `WorkoutProgramSchema` or any `validateEditedProgram` issue, with the previous program left
      unchanged; **409 `edit_conflict`** carrying the plan's **current** `updatedAt` on a stale
      `expectedUpdatedAt`; a matching `expectedUpdatedAt` succeeds and the response's `updatedAt`
      advances past it; on 0 rows updated, the route re-reads the scoped row to disambiguate
      404/409-not-ready/409-conflict rather than returning a generic failure
- [ ] D.8 GREEN: in `apps/api/src/routes/plan.ts` — register `PUT /workout-plans/:id/program`
      implementing the seven ordered steps: (1) Fastify JSON schema → 400 on a malformed envelope; (2)
      `WorkoutProgramSchema.parse` → 422 `invalid_program` (strips `catalogId` structurally); (3)
      `validateEditedProgram` → 422 with the specific issue; (4) load the plan (tenant+user+id) → 404
      `not_found` | 409 `plan_not_ready`; (5) `repo.findConfirmedById(tenantId, userId,
      plan.planSpecId)` (the real method name — **not** `findSpecById`, which does not exist, per
      Judgment Day finding 6) → `resolveExerciseVocabulary(spec.equipment)` → the **full** vocabulary
      set, not the prompt-capped subset (`catalog-resolution.ts:53-58`) → `resolveProgramCatalogIds`
      (reused verbatim, never reimplemented); carry over `limitationWarnings` from the stored program,
      never the submitted body; (6) `repo.updateProgram(..., expectedUpdatedAt)` → 200 | undefined; (7)
      on undefined, re-read the scoped row to disambiguate 404 / 409 `plan_not_ready` / 409
      `edit_conflict` (with the row's current `updatedAt`); report unresolved exercises via
      `observability.recordEvent({ event: "plan.edit_exercise_unresolved" })`, ids and name only; on
      success, revalidate `/plan` and `/plans` server-side so the same tab cannot keep rendering a day
      tile the program no longer contains; confirm D.7 is green

### The web editor UI

- [ ] D.9 RED: RTL + jsdom component test for a new
      `apps/web/src/app/(app)/plan/[id]/edit/__tests__/ProgramEditor.test.tsx` — loads the current
      program and its `updatedAt`; submits an edit carrying that `updatedAt` back as
      `expectedUpdatedAt`; on a `409 edit_conflict` response, renders a message distinct from a
      validation error and offers a reload; on a `409 plan_not_ready`, renders that a `generating`/
      `failed` plan cannot be edited; a submission removing every session is blocked client-side before
      the request (surfacing `validateEditedProgram`'s "keep at least one session" rule early, though
      the server remains the source of truth)
- [ ] D.10 GREEN: create `apps/web/src/app/(app)/plan/[id]/edit/{page.tsx,ProgramEditor.tsx,
      program-edit-client.ts,actions.ts}`; no edit affordance renders on an archived row per PR B's
      list UI (archive is allowed server-side but inert without a session — no new client-side gate
      needed beyond simply not rendering the control there); confirm D.9 is green

### The tracker invariant guard

- [ ] D.11 RED then GREEN, one commit (the guard is the deliverable — no production code change):
      `apps/web/src/app/(app)/plan/[id]/tracker/__tests__/tracker-model.invariant.test.ts` — a
      source-scan asserting `tracker-model.ts` contains no `programJson`/`WorkoutProgram`/`plan.program`
      reference; stated in the guard's own comment as a lint pinning a structural guarantee, not a type
      — a determined rename defeats it, but the real guarantee is `WorkoutSessionRecord` having no
      program member at all (structural, not tested-for)

### End-to-end proof

- [ ] D.12 RED then GREEN:
      `apps/api/src/db/repositories/__tests__/workout-plan-edit.integration.test.ts` — seed a ready
      plan, `updateProgram` with a changed exercise name, `startSession` the same day, assert the new
      `session_exercises` row carries the edited name (the "next start reflects the edit" acceptance
      criterion); edit 4 days down to 3, `startSession` the removed day, assert `404 { error:
      "day_not_in_plan", availableDays: [1,2,3] }` (exercising PR B's refusal end-to-end, not adding a
      new one); start a session, then edit that plan's program while it is active, assert the active
      session's `session_exercises`/`set_records` are byte-identical before and after (Judgment Day's
      strongest guarantee, proved behaviorally as well as structurally by D.11). Picked up
      automatically by the CI glob — no workflow edit

### i18n

- [ ] D.13 GREEN: add `planEdit.*` (form labels, conflict message, not-ready message, remove-day
      validation message) to `packages/i18n/src/messages/{en,es}.json`, both locales; bump the
      leaf-key-count canary; rebuild before manual verification

### PR D verification

- [ ] D.14 Verify: `pnpm -r test` green; `pnpm -r --if-present test:coverage` green (apps/api functions
      ≥85%, apps/web functions ≥90%, `packages/domain` under the global 100% functions threshold);
      `pnpm type-check` clean; `pnpm build` succeeds

---

## Final Verification (run once the full chain has landed)

- [ ] `pnpm -r test` — full suite green, hermetic
- [ ] `pnpm -r --if-present test:coverage` — apps/api functions ≥85%, apps/web functions ≥90%, global
      functions 100%
- [ ] `pnpm type-check` — no errors, all workspaces
- [ ] `pnpm build` — CI's real gate, succeeds (also confirms `packages/i18n` rebuild picked up every new
      catalog entry across PRs A, B, and D)
- [ ] Grep confirms the migration journal entry `idx: 29` is present and contiguous with `idx: 28`
- [ ] Grep confirms the no-DELETE guard names both `/workout-plans*` and `/plan-specs*`
- [ ] Grep confirms no `catalogId` literal reaches `repo.updateProgram`'s call site from the raw request
      body (D.7's structural proof, re-checked manually once)
- [ ] Grep confirms `tracker-model.ts` still contains no `programJson`/`WorkoutProgram`/`plan.program`
      reference (D.11, re-checked manually once)
- [ ] Manual: open `gh issue view 399` (or the MCP equivalent) and confirm nothing was added to the
      issue after `proposal.md` was written — flagged as unconfirmed in `design.md`'s open questions
      because that phase had no shell access
- [ ] Manual: confirm `?progress=1` has no effect on trainer-facing plan reads — `findLatestReadyByOwner`
      is untouched by this change, but no trainer surface should be found calling `findAllByUser` in a
      way that would silently start hiding an archived client's plan from a trainer view
