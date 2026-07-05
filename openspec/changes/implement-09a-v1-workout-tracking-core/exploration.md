# Exploration: 09a-v1-workout-tracking-core

## Current State

**Critical correction to prior init context**: the "zero source files" claim is stale. The repo is a mature pnpm monorepo with 7+ archived, verified changes (01a–07) already implemented. `openspec/specs/` and `openspec/changes/archive/` are richly populated (~120 files).

- `apps/api` (Fastify + Drizzle/PostgreSQL): tenant provisioning/repositories, auth (sessions/credentials/oauth), plan draft/spec/workout-plan routes+repos, AI generation service, admin config, WS registry.
- `apps/web` (Next.js 16, App Router, PWA): wizard UI, plan pages, orbit design system, i18n.
- `apps/mobile` (Expo/React Native): early auth screens, deep-link handling.
- `packages/contracts`: cross-boundary DTOs only, no DB imports. Already exports `WorkoutSession` (AI-generated per-day plan session — NOT the tracking session), `WorkoutExercise`, `WorkoutProgram`, tenant/session DTOs.
- `packages/domain`: pure logic (plan draft, preference scoring, password/session validation), zero framework/DB imports, enforced by `pnpm architecture` (dependency-cruiser + `scripts/deps-guard.mjs`).
- No `.codegraph/` index present; used Glob/Grep/Read directly.

## Dependency Readiness

- **`01c-v1-multi-tenant-schema`** — Archived 2026-06-21, verify-report PASS. Implemented: `tenants`, `users`, `memberships` tables; `TenantQueryContext` + `assertTenantContext`/`assertTenantIdMatchesContext` (`apps/api/src/tenant/tenant-context.ts`); `TenantRepository`; `provisionTenantForUser`.
- **`05b-v1-security-tenant-validation`** — Archived 2026-06-23, verify-report PASS. Enforces boundary validation (422) and secure defaults (401 fail-closed). Live precedent in `apps/api/src/routes/plan.ts` and `apps/api/src/db/repositories/workout-plan.ts`: every tenant-owned repository query requires `(tenantId, userId, id)` all matching, and returns `undefined` → route maps to **404** for cross-tenant/cross-user mismatches (not 403, despite 05b's general text mentioning 403 for "cross-tenant access"). This is the actual established convention, not spec prose.

**Both dependencies are real, implemented, and verified — 09a is NOT blocked.**

## Affected Areas

- `apps/api/src/db/schema.ts` — needs new tables for workout tracking; **naming collision**: `sessions` is already the auth bearer-token table. New tables must be named distinctly, e.g. `workout_sessions`, `session_exercises`, `set_records`.
- `packages/contracts/src/index.ts` — **naming collision**: `WorkoutSession` already exists as the AI-generated per-day plan session type. The new tracking-session entity needs a different name (e.g. `WorkoutSessionRecord`, `TrackedSession`).
- `apps/api/src/db/repositories/workout-plan.ts` — reference pattern for the new session/set repositories (tenant+user scoped queries, `undefined` on mismatch → 404).
- `apps/api/src/routes/plan.ts` — reference pattern for route wiring, `requireAuth()` preHandler, DTO mapping discipline (never return raw Drizzle rows).
- `packages/domain/src/` — RPE 0-10 validator belongs here as a pure function, following the `validatePasswordPolicy`-style precedent.
- `apps/web/src/app/(app)/plan/` — likely location for the new live tracker / exercise execution surfaces (Next.js App Router, Server Actions calling API via httpOnly session cookie).
- README.md (line 176) confirms intended domain vocabulary: `WorkoutSession` / `SessionExercise` / `SetRecord` hierarchy — must be reconciled with the existing contracts naming.
- No existing `openspec/changes/*workout*` in-progress change — no duplication risk.

## Approaches

1. **Snapshot exercise data at session start** — when a workout session is created, copy the relevant exercise/set plan (name, sets, reps, rest) from `workoutPlans.programJson` into new relational rows (`session_exercises`, planned sets).
   - Pros: Session history remains stable even if the plan is later regenerated; matches `workoutPlans`' own "retain audit rows" philosophy; simpler queries (no JSON reach-through at read time).
   - Cons: Slight duplication of exercise data; requires a mapping step from `WorkoutProgram` JSON to relational rows at session-create time.
   - Effort: Medium

2. **Live reference to `workoutPlans.programJson`** — session/set records only store an index into the JSON program; exercise metadata is read live at request time.
   - Pros: No duplication; single source of truth for exercise definitions.
   - Cons: Breaks if the plan is regenerated mid-cycle (stale index, or plan deleted); couples session read-path to JSON parsing of another table; complicates "live tracker" queries (extra join + JSON parse per request).
   - Effort: Medium-High (more fragile)

## Recommendation

Approach 1 (snapshot at session start). It matches the codebase's existing philosophy of retaining historical rows for audit (`workoutPlans` keeps stale "generating"/"failed" rows rather than mutating), avoids fragile JSON-index coupling, and keeps the live tracker's read path simple relational queries consistent with the rest of `apps/api`. The proposal/design phase should also explicitly settle the two naming collisions (`sessions` table, `WorkoutSession` type) before writing schema/contracts, and adopt the existing 404-on-mismatch convention (not 403) for tenant/user scope violations to stay consistent with `workoutPlans` and `plan.ts`.

## Risks

- Naming collision risk: `sessions` table and `WorkoutSession` type are already taken by unrelated concepts (auth session, AI plan-generation session). Left unresolved, this risks confusing migrations, ambiguous imports, or accidental type collisions across `@kinora/contracts`.
- Status-code inconsistency risk: 05b's spec text says 403 for cross-tenant access, but the actual established repository/route convention returns 404 (via `undefined` lookups). The 09a spec text itself says "no session data" (ambiguous). This needs an explicit, documented decision rather than silent inconsistency.
- Data-modeling risk: choosing between snapshot vs. live-JSON-reference has real consequences for correctness when a plan is regenerated mid-session — must be decided before schema/migration is written.
- Scope-creep risk: the spec explicitly excludes analytics ("not becoming a progress analytics surface") and offline sync (deferred to `09b-v1-workout-offline-history`) — proposal must keep strictly to online CRUD + live tracker + execution surface.

## Ready for Proposal

Yes. Both dependencies (`01c`, `05b`) are implemented and verified, not just spec-only. No existing conflicting change. Clean Architecture conventions (tenant-scoped repositories, DTO mapping discipline, pure-domain validators) are well-established and directly reusable. The proposal should explicitly resolve the `sessions`/`WorkoutSession` naming collisions and pick the snapshot-based exercise data model before design.

---

_Persisted to Engram: `sdd/implement-09a-v1-workout-tracking-core/explore` (id 1720)._
