# Proposal: Progress Dashboard, Statistics & Weekly Overview (09c)

## Intent

After tracking (09a) and offline history (09b), completed workout data exists but is only surfaced as a raw history list. The web dashboard/stats/exercises pages are placeholder scaffolds. This change turns session + history data into progress feedback: a Dashboard Progress Summary (including weekly adherence and a day-streak), a Statistics Surface (volume, muscle-group distribution, trends, PRs — adherence lives on the dashboard, not here), a Weekly Plan & Progress Overview (a Monday–Sunday calendar board), and exercise-detail history references. Delivers README roadmap item 09c.

## Scope

### In Scope (web-first)
- Dashboard Progress Summary: today's context, day-streak (consecutive training days) and weekly adherence (completed vs. planned sessions this calendar week, shown as X/Y), recent progress, quick actions, empty state.
- Statistics Surface: volume, trends, KPI period-deltas, **muscle-group distribution**, personal records (PRs). Adherence is NOT a Statistics KPI — it lives on the dashboard.
- Weekly Plan & Progress Overview: a 7-day calendar week (Monday–Sunday) with prev/next navigation, each day showing exactly one of done/active/rest/soon (no "missed").
- Exercise-detail history reference (recent performance for the selected exercise).
- **Muscle-group taxonomy + backfill** for existing exercises/sessions (biggest scope driver).
- Calendar-week adherence + day-streak semantics; all calendar bucketing in a fixed UTC reference for v1.

### Out of Scope (Non-Goals)
- **Mobile dashboard/stats/weekly surfaces** — no mobile surface or nav slot exists today; deferred to a follow-up change.
- Plan-week semantics anchored to plan creation, and a "missed" day state (superseded — the settled model is a navigable calendar week with states done/active/rest/soon).
- Per-user timezone for calendar bucketing (v1 uses a fixed UTC reference; per-user tz is a future enhancement).
- Real per-user training-weekday scheduling (the plan model has no weekday anchor; the calendar board's planned overlay is a deterministic display convention for v1).
- Monolithic single "progress snapshot" endpoint (rejected in exploration).

## Capabilities

### New Capabilities
- None (all four requirements live in `openspec/specs/09c-v1-progress-dashboard-stats/spec.md`).

### Modified Capabilities
- `09c-v1-progress-dashboard-stats`: scope the four requirements to web-first; define "week" = **calendar week (Monday–Sunday)** with prev/next navigation and states done/active/rest/soon (no "missed"); adherence = completed vs. planned sessions for the current calendar week, shown on the **Dashboard** (not Statistics); streak = consecutive training days; all calendar bucketing in a fixed UTC reference; require muscle-group distribution backed by a new taxonomy.

## Approach

Purpose-built repository query per surface + pure domain aggregation (exploration Approach 1), mirroring 09b's batch-fetch no-N+1 discipline — NOT one snapshot endpoint. Reuse `listCompletedSessions` + `computeSessionVolume/AverageRpe/VolumeTrend`. New pure aggregation (streak/adherence, muscle-group distribution, PRs, weekly plan-vs-completion) in `packages/domain`, exported via a **subpath (`@kinora/domain/progress`)** — never the root barrel (pulls `node:crypto`, breaks the Next build). New DTOs in `packages/contracts`, thin routes in `apps/api`. i18n via next-intl + `@kinora/i18n` (EN/ES parity) from day one. Strict TDD: aggregation + repo/route are test-first.

### Key architectural/data decision for sdd-design: muscle-group taxonomy + backfill
There is NO muscle-group metadata in the model today (`session_exercises.title` and `WorkoutExercise` are name-only). Design resolved: (a) exercises stay free-text on `session_exercises`; (b) an additive/nullable `muscle_group` column (clean rollback); (c) taxonomy = a bilingual EN/ES keyword classifier over the 10 primary groups; (d) an idempotent, batched backfill with a reclassify path. Week semantics are also settled in design: **calendar week (Monday–Sunday)**, not a plan-week anchored to `createdAt`; `weeklySessions[].day` is a sequential plan-day index with no calendar-weekday anchor, so "done" is date-driven and the planned overlay is a deterministic display convention; all calendar bucketing uses a fixed UTC reference for v1.

### UI design source: OpenDesign (kiNorA)
These are net-new visual surfaces, so their layout/visual design comes from OpenDesign, not ad-hoc styling — consistent with the rest of the app (see the plan-view alignment, issue #128). The design source is the OpenDesign **kiNorA** project (`ceeff5f6-0930-4e48-a0b0-17a6a5c9b9ad`). Before implementing each surface, pull the current design via the OpenDesign MCP (`get_artifact`/`get_file`) and build to it (layout, spacing, typography, design tokens, component structure). sdd-design MUST confirm that up-to-date OpenDesign designs exist for Dashboard, Statistics, and Weekly Overview; **if a surface has no design yet, obtaining/creating it in OpenDesign is a prerequisite for that surface's implementation slice** (flag as a blocker rather than improvising the UI).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/web/.../dashboard/page.tsx`, `stats/page.tsx`, `exercises/page.tsx` | Modified | Scaffolds → data-backed surfaces, built to the OpenDesign kiNorA design |
| OpenDesign **kiNorA** project (`ceeff5f6-…`) | Design source | Visual source of truth for the new surfaces; pull via MCP before implementing |
| `apps/web/.../plan/PlanWeekView.tsx` | Modified | Realign to OpenDesign `web-plan.html` (slice 4a, absorbs #128), then add the Monday–Sunday calendar board with prev/next navigation and day states done/active/rest/soon (slice 4b) |
| `apps/api/.../repositories/workout-session.ts`, `routes/` | New/Modified | Per-surface bounded queries + thin routes |
| `apps/api/src/db/schema.ts` | Modified | Additive/nullable muscle-group column(s) + backfill |
| `packages/domain/src/progress/` | New | Pure adherence/streak/distribution/PR/weekly aggregation (subpath export) |
| `packages/contracts/src/index.ts` | New | Progress DTOs |
| `packages/i18n` catalogs | New | EN/ES progress copy |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Muscle-group taxonomy + backfill balloons scope | High | Own delivery slice; additive/nullable schema; design decides source before tasks |
| Week/calendar semantics undefined today | Med | Resolved in sdd-design: calendar week (Mon–Sun), UTC bucketing, date-driven "done", deterministic planned-overlay convention |
| Domain root-barrel breaks Next build | Med | Export via `@kinora/domain/progress` subpath only |
| Web+all surfaces exceed 400-line review budget | High | Slice delivery; mobile deferred |
| PR/distribution aggregation untested (net-new) | Med | Pure functions unit-tested in `packages/domain` |
| OpenDesign design missing for a surface → improvised UI | Med | sdd-design confirms designs exist; missing design blocks that surface's slice until created in OpenDesign |

## Rollback Plan

Additive and feature-gated per slice. Muscle-group schema is additive/nullable (drop column to revert, no data loss). Each surface (dashboard, stats, weekly overview) is an independently removable read query + page. Backfill is idempotent and re-runnable; taxonomy absence degrades to "no distribution" rather than breaking other surfaces.

## Dependencies

- `09a-v1-workout-tracking-core` (implemented)
- `09b-v1-workout-offline-history` (implemented — reuse aggregation + `listCompletedSessions`)
- `06b-v1-orbit-ui-shell` (implemented — nav + shell)
- OpenDesign **kiNorA** project — up-to-date designs for Dashboard, Statistics, and Weekly Overview must be available before each surface's implementation slice (design-phase prerequisite).

## Delivery Slicing (final slicing by sdd-tasks)

(1) muscle-group taxonomy + schema + backfill; (2) dashboard summary; (3) statistics surface; (4) weekly board + exercise detail, split into two chained sub-slices — **4a** visual realignment of the plan-view to OpenDesign `web-plan.html` (absorbs issue #128, no new data behavior) and **4b** the weekly-progress data (calendar-board day states, week navigation, adherence wiring) + exercise-detail reference. #128 closes when 4a ships.

## Success Criteria

- [ ] Dashboard shows today's context, a day-streak (consecutive training days), weekly adherence as completed vs. planned sessions for the current calendar week (X/Y), recent progress, quick actions, and a guiding empty state (Req 1).
- [ ] Statistics shows volume, muscle-group distribution, trends, KPI period-deltas, and PRs when data exists, with NO adherence KPI (adherence is a dashboard concern) (Req 2).
- [ ] Weekly overview presents a Monday–Sunday calendar week with prev/next navigation, each day showing exactly one of done/active/rest/soon (no "missed") (Req 3).
- [ ] Exercise detail references recent history without replacing live tracking (Req 4).
- [ ] Weekly adherence (on the Dashboard) = completed sessions vs. planned sessions for the current calendar week; "done" is date-driven from `completedAt` and all calendar bucketing uses a fixed UTC reference for v1.
- [ ] KPI deltas are null ("new") when the previous period has no data (never divide-by-zero); estimated-1RM PRs consider only completed sets with weight > 0 and reps > 0.
- [ ] All four progress queries are scoped by (tenantId, userId), including free-text `getExerciseDetail(title)` (no IDOR).
- [ ] Muscle-group schema is additive/nullable; backfill is idempotent, batched, and has a reclassify path; the classifier is bilingual (EN/ES).
- [ ] Each new surface visually matches the OpenDesign **kiNorA** design (layout, spacing, tokens, components).
- [ ] New aggregation exported via `@kinora/domain/progress`; `pnpm test`, `pnpm type-check`, `pnpm architecture`, `pnpm build` pass; EN/ES parity.
