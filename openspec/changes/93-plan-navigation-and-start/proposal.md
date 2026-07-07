# Proposal: Plan Navigation and Start (Issue #93)

## Intent

Three compounding problems make it impossible for a user to start a workout from a ready plan through normal navigation:

1. **Start CTA unreachable.** The Plan nav tab lands on `/plan`, which renders `DayDetailPanel` — a view that explicitly defers the "Empezar sesión" button (SC-23 of 09c). The button exists only in `PlanStatusView` on `/plan/[id]`, a route never linked for ready plans.
2. **Session start ignores plan+day scope.** `startSession` returns any existing active session regardless of which plan or day was requested, and the `workout_sessions` table has no `day` column — sessions cannot be attributed to a training day.
3. **Plans have no user-facing name.** The wizard never captures a name; `PlanSelector` displays only `"{date} ({status})"`, making multiple plans indistinguishable.

These combine to make the core post-generation loop (create plan → navigate → start session) broken.

## Scope

### In Scope

- **Start CTA in DayDetailPanel.** Add a per-day "Empezar sesión" button inside `DayDetailPanel` that links/submits to the workout tracker for the correct `(planId, day)` pair.
- **Plan name field — end to end.** Optional name captured in the wizard → persisted on `workout_plans` (DB migration: `name VARCHAR(120)`) → surfaced in `PlanSummary` DTO, list/detail API responses → rendered in `PlanSelector` and plan view header. Auto-default if blank (e.g. "Plan {N}" or date-based).
- **Session day attribution — DB migration.** Add `day SMALLINT` column to `workout_sessions` so each session records which training day it represents.
- **Scoped active-session lookup with conflict surfacing.** `WorkoutSessionRepository.findLatestActiveSession` gains a `(planId, day)` overload. `startSession` uses it as follows: if the single active session matches `(planId, day)` → resume it; if the active session belongs to a *different* `(planId, day)` → surface "you have an active session for \<plan/day\>" and require the user to resume or finish it first (do NOT silently return the wrong session, do NOT attempt to create a second active session — the `singleActivePerUser` partial unique index would reject it anyway). The `day` column is what makes this attribution and comparison possible.
- **Multi-week tracking (explicit, in scope).** The weekly template is unchanged. Repeating a training day in a later real-world week produces a **new** session row with its own `startedAt` timestamp — the date comes from `startedAt`, no `week` column is needed. Per-day history is therefore keyed by `(planId, day, startedAt)` and must NOT be collapsed by `(planId, day)` alone; every occurrence over time is a distinct, dated record.
- **i18n coverage.** All new user-facing strings in `en.json` / `es.json`.
- **Route compliance.** All new server-side reads go through server actions (no direct browser → API_BASE_URL); new API access respects the #85 route-layer rule (routes must not import db directly).

### Out of Scope

- **Per-week periodization (plan content varying by week).** The plan model stays a single repeating weekly template (Day 1..N); no `week` column is added, and no multi-week plan model is introduced.
- Offline session sync (09b-v1-workout-offline-history).
- Workout history analytics / progress dashboard (09c-v1-progress-dashboard-stats).
- Plan renaming after creation (future CRUD).
- Multi-active-session support (current single-active invariant is preserved — the DB partial unique index `singleActivePerUser` enforces at most one `status='active'` session per user at a time).

## Capabilities

### New Capabilities

- `93a-plan-day-start-cta`: Per-day "Empezar sesión" CTA in `DayDetailPanel`, routing to the tracker with `(planId, day)` context.
- `93b-plan-name`: Optional plan name captured in wizard, persisted, and displayed throughout the plan view and selector.
- `93c-session-day-attribution`: `day` column on `workout_sessions`; scoped active-session lookup by `(planId, day)`.

### Modified Capabilities

- `07-v1-plan-wizard`: Add optional `name` field to wizard step flow and `PlanSpec`/draft output.
- `09a-v1-workout-tracking-core`: Refine Single Active Session requirement — the DB `singleActivePerUser` partial unique index already enforces at most one active session per user; resume semantics become `(planId, day)`-scoped: matching pair → resume, non-matching pair → surface conflict and block start until the active session is resolved.
- `09b-plan-view`: `PlanSummary` gains `name` field; SC-23 label logic updated; selector shows name.
- `09c-plan-view-design`: SC-12 and SC-23 updated — "Empezar sesión" CTA is no longer absent; detail panel includes the start button.

## Approach

Deliver in three ordered slices, each independently mergeable:

| Slice | PR | Scope | Dependency |
|-------|----|-------|------------|
| 1 — Data model | `feat/93-data-model` | DB migrations (`workout_plans.name`, `workout_sessions.day`); contracts + domain types updated; repo methods updated | none |
| 2 — Plan name UX | `feat/93-plan-name` | Wizard optional name step; API DTO; selector + header display; i18n | Slice 1 |
| 3 — Start CTA + scoped session | `feat/93-start-cta` | `DayDetailPanel` button; `startSession` scoped lookup; tracker receives `(planId, day)` | Slices 1 + 2 |

Each slice targets `main` directly (no long-lived feature branch needed). Slice 1 is the unblocking foundation for the other two.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/web/src/app/(app)/plan/page.tsx` | Modified | Pass `planId` to DayDetailPanel; no longer blocks start CTA |
| `apps/web/src/app/(app)/plan/_components/DayDetailPanel.tsx` | Modified | Add per-day start CTA; remove deferred marker |
| `apps/web/src/app/(app)/create-plan/` | Modified | Optional name step/field in wizard |
| `apps/api/src/db/repositories/workout-session.ts` | Modified | `findLatestActiveSession` gains `(planId, day)` filter |
| `apps/api/src/routes/workout-sessions/` | Modified | `startSession` route passes `day` to repo |
| `packages/contracts/src/` | Modified | `PlanSummary` + `WorkoutSession` types gain `name`/`day` |
| `packages/domain/src/` | Modified | Domain entities updated for `name` + `day` |
| DB migration (new file) | New | `workout_plans.name VARCHAR(120) NULL`, `workout_sessions.day SMALLINT NULL` |
| `apps/web/src/i18n/en.json`, `es.json` | Modified | New keys for CTA + plan name labels |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Active-session resume semantics change (user mid-session on old data has no `day`) | Med | `day` column is nullable; old sessions (day=null) resume as-is; scoped lookup treats null-day sessions as non-matching and surfaces the conflict prompt rather than silently hijacking them |
| Wrong active session silently returned for mismatched `(planId, day)` (current bug) | High | Fixed by scoped lookup + explicit conflict surfacing; the `singleActivePerUser` unique index is the hard backstop that prevents a second active session being created inadvertently |
| Plan name migration adds nullable column — existing rows have null name | Low | Auto-default display logic ("Plan {N}") covers null names in selector/header |
| DayDetailPanel becomes client-heavier with CTA state | Low | CTA is a link/server-action form; no new client state needed |
| Route-layer compliance (#85) violated if new API access added carelessly | Med | Design phase must diagram data-flow for start action; enforce server-action gateway |

## Rollback Plan

- Slices 1–3 are each a standard PR revert (`git revert <merge-commit>`).
- DB migrations: both columns are nullable additions — dropping them is a safe `ALTER TABLE DROP COLUMN` with no data loss.
- No breaking contract changes in Slice 1 (additive fields); clients consuming old DTOs ignore unknown fields.

## Dependencies

- Issue #85 route-layer rule already merged — new work must comply.
- `09c-plan-view-design` already delivered the `DayDetailPanel` scaffolding that Slice 3 extends.

## Success Criteria

- [ ] Clicking the Plan nav tab → selecting a day card → clicking "Empezar sesión" starts a tracker session for that `(planId, day)` without navigating to `/plan/[id]`.
- [ ] Two ready plans can be told apart in `PlanSelector` by their names (or auto-defaults).
- [ ] `workout_sessions` rows record the `day` of the session; `startSession` with the same `(planId, day)` resumes the existing active session.
- [ ] `startSession` called for a `(planId, day)` pair that does NOT match the current active session surfaces a conflict message (plan name + day) and does NOT create a second active session (the `singleActivePerUser` partial unique index enforces this at the DB level).
- [ ] Repeating a training day in a later week creates a new session row with its own `startedAt` date; per-day history lists every occurrence over time, not just the latest.
- [ ] All new strings appear in EN and ES catalogs with no hardcoded English literals.
- [ ] `pnpm architecture` passes (no route→db direct imports).
- [ ] Vitest suite passes for modified repo, domain, and server-action units.
