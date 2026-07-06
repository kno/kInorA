# Archive Report: implement-09a-v1-workout-tracking-core

**Change**: `implement-09a-v1-workout-tracking-core`
**Archived to**: `openspec/changes/archive/2026-07-06-implement-09a-v1-workout-tracking-core/`
**Archive date**: 2026-07-06
**Artifact store**: hybrid (OpenSpec filesystem + Engram persistence)
**Verdict**: PASS WITH WARNINGS — archived cleanly; 0 CRITICAL; 2 WARNING (both since closed — see below); 2 SUGGESTION carried forward as notes
**Merged PR**: #89 (merge commit `0714a97` to `main`)

---

## Task Completion Gate

All implementation tasks (1.1–4.2) verified `[x]` in `tasks.md` before archive. No stale unchecked tasks. No exceptional reconciliation was required.

| Phase | Tasks | Complete |
|-------|-------|----------|
| Phase 1 — Foundation / Schema | 1.1–1.4 (4) | 4 |
| Phase 2 — API Core | 2.1–2.5 (5) | 5 |
| Phase 3 — Web Tracker Surface | 3.1–3.4 (4) | 4 |
| Phase 4 — Verification / Cleanup | 4.1–4.2 (2) | 2 |
| **Total** | **15** | **15** |

---

## Archive Contents

| Artifact | Status |
|----------|--------|
| `exploration.md` | Present |
| `proposal.md` | Present |
| `specs/09a-v1-workout-tracking-core/spec.md` | Present (delta spec — source for main spec merge) |
| `design.md` | Present |
| `tasks.md` | Present — 15/15 tasks `[x]` |
| `apply-progress.md` | Present — cumulative Phase 1–4 |
| `archive-report.md` | This document |

`verify-report` lives in Engram only (observation #1792) per the hybrid store used for this change; the traceability IDs are recorded below.

---

## Engram Traceability (observation IDs)

| Artifact | Observation ID |
|----------|----------------|
| explore | #1720 |
| proposal | #1740 |
| spec (delta) | #1742 |
| decision — single active session | #1744 |
| SDD artifacts summary | #1746 |
| tasks | #1745 |
| apply-progress | #1749 |
| apply — Phase 1 foundation | #1748 |
| apply — Phase 2 API core | #1759 |
| apply — Phase 3 web tracker | #1786 |
| verify-report | #1792 |
| archive-report | this observation (`sdd/implement-09a-v1-workout-tracking-core/archive-report`) |

---

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `09a-v1-workout-tracking-core` | Updated | Applied 5 MODIFIED requirements + 4 ADDED requirements from the delta spec |

**Delta applied from**: `openspec/changes/archive/2026-07-06-implement-09a-v1-workout-tracking-core/specs/09a-v1-workout-tracking-core/spec.md`
**Updated main spec**: `openspec/specs/09a-v1-workout-tracking-core/spec.md`

### ADDED requirements (new in main spec)

1. **Planned Exercise Snapshot** — starting from a ready plan snapshots exercises, set targets, instructions, and rest context so later plan edits do not change the session.
2. **Session Completion** — the owning user completes an active session; completed sessions expose completed state and disable active set-recording actions.
3. **Single Active Session** — at most one active session per user; starting another returns/resumes the existing one instead of duplicating.
4. **Slice Boundaries** — this slice explicitly excludes analytics, statistics, offline capture, offline history, and offline sync.

### MODIFIED requirements (replaced matching requirement in main spec)

1. **Workout Session Recording** — now ties sessions to ready-plan start and snapshots; sets support reps, weight, completion status, notes, and valid RPE. Added scenario "Start requires ready plan".
2. **Live Session Tracker Surface** — now includes completion state and next action explicitly (online scope).
3. **Exercise Execution Surface** — now makes the analytics exclusion explicit for the execution surface.
4. **RPE Validation** — now specifies RPE is numeric and constrained to the inclusive 0-10 range. Added scenario "Valid RPE accepted".
5. **Tenant-Scoped Session Access** — now covers user mismatch (same tenant) and mandates 404-style no-data responses. Added scenario "Other user session hidden".

Requirements not mentioned in the delta: none — every requirement in the main spec was either ADDED or MODIFIED by this change; nothing else existed to preserve.

---

## WARNING Resolution

- **WARNING 1 — "Start requires ready plan" scenario untested — SINCE CLOSED**: The verify-report flagged this scenario as having no covering behavioral test. The `apply-progress.md` Phase 4.1(d) evidence (more recent than the verify snapshot) shows three characterization tests were added: repo `returns undefined and performs no insert when the plan is not in a ready state`, repo `returns undefined and performs no insert when the requested day does not exist in the plan`, and route `returns 404 when start is called for a plan that is not ready`. Targeted API run then reported `2 files passed, 23 tests passed` (was 20). The scenario is now covered; no follow-up needed.
- **WARNING 2 — file-plan deviation not noted in apply-progress**: `design.md` referenced `plan-draft-client.ts` and `boundary.ts`; the shipped implementation used `tracker-client.ts` plus route-local Fastify schemas. Functionally equivalent and cleaner. The apply-progress "Deviations: None" line was therefore inaccurate on this point. Recorded here as the authoritative correction; no code change needed.

## SUGGESTION Notes (carried forward)

- **SUGGESTION 1** — apply-progress "Deviations from Design: None" is a minor honesty gap given WARNING 2. Corrected in this report.
- **SUGGESTION 2** — no dedicated exercise-detail route; the exercise execution surface is realized inline in `TrackerPanel`. Design-consistent and acceptable; worth noting for 09b/09c continuity.

---

## Open Follow-Ups

| Item | Owner | Priority |
|------|-------|----------|
| Note the inline exercise-execution surface (no dedicated route) when planning 09b/09c | Product/Web | Low |
| Route-layer guardrails from issue #85 explicitly deferred per PR boundary | API/Security | Low |

---

## Deferred / Out-of-Scope (correctly excluded, documented)

- Analytics/statistics → change `09c-v1-progress-dashboard-stats` (asserted absent in tracker test).
- Offline capture/sync/history → change `09b-v1-workout-offline-history` (asserted absent).

---

## Verify Report Summary

| Verdict | CRITICAL | WARNING | SUGGESTION |
|---------|----------|---------|------------|
| PASS WITH WARNINGS | 0 | 2 (both addressed above) | 2 (both noted above) |

**Repo-wide guards passed at verify/apply time (real output):**
- `pnpm type-check`: all 5 projects, 0 errors
- `pnpm test`: 1207 tests pass (mobile 34, contracts 32, domain 91, api 529, web 521)
- `pnpm architecture`: no violations (1518 modules)
- `pnpm deps-guard`: no prohibited dependencies
- `pnpm build`: domain/api tsc Done; web Next.js compiled, 17/17 pages

---

## Delivery Summary

| Slice | Goal | Scope |
|-------|------|-------|
| PR 1 — Contracts + Domain + Schema | Foundation | `validateRpe`, non-colliding tracking DTOs, `workout_sessions`/`session_exercises`/`set_records` + migration `0005_workout_tracking.sql` with partial unique active-session guard |
| PR 2 — API | Session repo + routes | Tenant/user-scoped repository, snapshot-on-start, active-session reuse, set writes, completion, protected `workout-session` routes (401/404/422) |
| PR 3 — Web | Tracker UI + actions | Server-only workout-session helpers (`tracker-client.ts`), Next server actions, live `TrackerPanel`, ready-plan start CTA, bilingual copy |
| PR 4 — Verification | Coverage + sweep | Snapshot immutability, RPE boundary, cross-user isolation tests; full verification sweep |

**Chain strategy**: stacked-to-main. Final merge to `main` via PR #89 (merge commit `0714a97`).

---

## Source of Truth Updated

The following spec now reflects the implemented and verified behavior:

- `openspec/specs/09a-v1-workout-tracking-core/spec.md`

---

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
No CRITICAL issues. Spec source of truth updated with all ADDED/MODIFIED requirements.
Ready for the next change (`09b-v1-workout-offline-history` / `09c-v1-progress-dashboard-stats`).
