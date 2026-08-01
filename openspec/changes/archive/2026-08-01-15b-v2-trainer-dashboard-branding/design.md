# Design: Trainer Dashboard & Branded Plans (15b v2)

## Technical Approach

Three additive capabilities on the 15a foundation: (1) a trainer dashboard-read route reusing `resolveAuthorizedOwner` plus a new multi-point metrics repo method and pure domain aggregators; (2) a NEW deny-by-default client→trainer-tenant read primitive (`resolveClientTrainerTenant`) resolving #283 without touching login/session; (3) branding on `PlanSpec.spec_json` rendered via an accent CSS variable (web) and a new accent-only theming seam (mobile). No destructive migrations.

Key discovery grounding the #283 decision: a trainer-built plan lives in the TRAINER's `tenantId` but is owned by the CLIENT's `userId` (`plan.ts:839` `promoteDraftToSpec(tenantId, ownerUserId=clientUserId)`). So the client reading their own trainer plan only needs to read rows keyed to their OWN `userId` in the trainer's tenant — a userId filter that is never widened.

## Architecture Decisions

### Decision: Trainer dashboard authorization + route
**Choice**: New `GET /trainer/clients/:clientUserId/dashboard` in `trainer.ts`, `requireAuth` → `resolveAuthorizedOwner(ctx, trainerAccess, clientUserId)` → new `WorkoutSessionRepository.getClientDashboard(tenantId, ownerUserId, now)`. Identical shape to `plan.ts:790-849`.
**Alternatives**: (a) extend `getDashboardSummary`; (b) separate `ClientProgressRepository`.
**Rationale**: New method (not extending `getDashboardSummary`) isolates the well-tested self-dashboard from new query semantics, but reuses its bounded session-fetch pattern (single `(tenantId,userId,status=completed)` page, no N+1). Tenant-safe by construction (req 3): trainer and client share the SAME `tenantId` in this call, so aggregation can never cross tenants.

### Decision: #283 client→trainer-tenant read (highest risk) — dedicated primitive, NOT login switch
**Choice**: NEW `resolveClientTrainerTenant(ctx, deps)` in `apps/api/src/trainer/client-access.ts`, and client route `GET /me/trainer-plan` (`requireAuth`). The function: `assignmentRepo.findByClientUserId(ctx.actorUserId)` → deny (`ForbiddenOwnerAccess`) unless a row exists with `status==="active"` AND `clientUserId===ctx.actorUserId`; returns that row's trainer `tenantId`. Route then reads `workoutPlanRepo.findLatestReadyByOwner(trainerTenantId, ctx.actorUserId)` — the userId filter is ALWAYS `ctx.actorUserId`, never widened.
**Alternatives**: Wire `selectActiveTenant` into `service.ts`/`social.ts` login as a global tenant switch.
**Rationale**: The login switch changes the session tenant for ALL requests of EVERY dual-membership user — a broad blast radius on the core sign-in surface. The dedicated primitive is strictly narrower: additive, opt-in, one new route, deny-by-default, assignment-scoped, and it can only ever return rows keyed to the client's own userId. `resolveAuthorizedOwner` is NOT reused — it is not symmetric (it widens a trainer INTO a client's owner-id within the trainer's own tenant; here a client crosses INTO the trainer's tenant reading only its own userId).
**Self-only-unchanged proof**: Zero lines change in `service.ts`/`social.ts`/`plugin.ts`; `selectActiveTenant` stays unwired. A user with no active assignment gets `findByClientUserId → undefined → 403`. Every existing self route still resolves owner = `ctx.actorUserId` against the session tenant. A non-client/non-trainer user's login and session are byte-identical.

### Decision: RPE time-series + completion-rate aggregation
**Choice**: New pure domain `computeRpeTrend(sessions, now)` (`packages/domain/src/progress/rpe-trend.ts`), mirroring `computeRpeAdaptation`. Window = last 8 UTC weeks (Monday-first, `utcWeekBounds` convention); granularity = per-week bucket (smooths sparse RPE better than per-session); up to 8 points; a week emits `meanRpe: null` (rendered as a gap) unless it has `>= 2` rated working sets. Completion-rate period = rolling 28 days ending `now` (matches adherence's 4-week window): `planned = plannedSessionsPerWeek * 4`, `completed` = distinct completed sessions in window, `percent = min(100, round(completed/planned*100))`. Recent sessions = last 5 completed (`date`, `volumeKg` via `computeSessionVolume`, `meanRpe` via `computeAverageRpe`, null when unrated).
**Rationale**: Deterministic, no I/O, unit-testable; weekly buckets satisfy req 1's "trends" (plural) that `RpeSnapshot`'s single window cannot.

### Decision: Branding storage + rendering
**Choice**: `PlanSpec.branding?: { trainerName?, title?, accentColor? }` on `spec_json` (mirrors `name`/`intensityBias`). NO new table. Validation: `accentColor` must match `^#[0-9a-fA-F]{6}$` else 400; `trainerName`/`title` capped at 60 chars. Web: set `style={{ "--plan-accent": accentColor }}` on the plan-view root; CSS module accent surfaces read `var(--plan-accent, <base-token>)`. Mobile: NEW minimal seam — thread `branding?.accentColor` as a prop into `PlanWeekView`/`PlanStatusView`; accent surfaces read `branding?.accentColor ?? colors.<default>` (accent-only keeps blast radius small; no full palette override in `tokens.ts`).
**Alternatives**: `trainer_plan_branding` table keyed by `workout_plan_id`.
**Rationale**: `spec_json` rides the proven promote→generate→confirm pipeline, needs no migration/join, and branding is authored at plan-creation by the trainer via the existing client-plan-create route. Trade-off (a branding edit looks like a spec write) is acceptable at authoring time. Absent branding → base plan renders (safe rollback).

## Data Flow

    Trainer: GET /trainer/clients/:id/dashboard
      requireAuth → resolveAuthorizedOwner(ctx,deps,clientId)=ownerUserId
        → getClientDashboard(trainerTenantId, ownerUserId, now)
        → { computeRpeTrend, completionRate, recentSessions } → ClientDashboardDTO

    Client: GET /me/trainer-plan
      requireAuth → resolveClientTrainerTenant(ctx,deps)=trainerTenantId
        → findLatestReadyByOwner(trainerTenantId, ctx.actorUserId)
        → WorkoutPlanDetail (incl. spec.branding) → web CSS var / mobile prop

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/routes/trainer.ts` | Modify | New dashboard route + client trainer-plan route |
| `apps/api/src/trainer/client-access.ts` | Create | `resolveClientTrainerTenant` (new authz primitive) |
| `apps/api/src/db/repositories/workout-session.ts` | Modify | `getClientDashboard` method |
| `apps/api/src/db/repositories/workout-plan.ts` | Modify | `findLatestReadyByOwner` (owner-parameterized read) |
| `packages/domain/src/progress/rpe-trend.ts` | Create | `computeRpeTrend` pure aggregator |
| `packages/contracts/src/index.ts` | Modify | `ClientDashboardDTO`, `RpeTrendPoint`, `PlanSpec.branding` |
| `apps/api/src/routes/plan.ts` | Modify | Validate `branding` in client-plan-create |
| `apps/web/.../plan/PlanWeekView.tsx`, `PlanStatusView.tsx` | Modify | `--plan-accent` CSS var render + branding title/name |
| `apps/mobile/.../plan screens` + `theme/tokens.ts` | Modify | Accent-only prop seam |

## Interfaces / Contracts

```typescript
export interface RpeTrendPoint { weekStart: string; meanRpe: number | null; sessionsWithRpe: number; }
export interface ClientDashboardDTO {
  rpeTrend: RpeTrendPoint[];                 // up to 8 weekly buckets
  completionRate: { periodDays: 28; planned: number; completed: number; percent: number };
  recentSessions: Array<{ date: string; volumeKg: number; meanRpe: number | null }>; // last 5
}
// PlanSpec gains:
branding?: { trainerName?: string | null; title?: string | null; accentColor?: string | null };
```
No new auth/session DTO — `SessionContext` unchanged; `selectActiveTenant` stays unwired.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (domain) | `computeRpeTrend` window/bucket/min-sample/gap; completion-rate math | pure fixtures, deterministic `now` |
| Unit (authz) | `resolveClientTrainerTenant` negatives (below) | fakes mirroring `owner-access.test.ts` |
| Integration | dashboard route owner resolution; branding validation 400 | supertest + fake repos |
| Integration | client trainer-plan read returns only own-userId rows | seeded 2-tenant fixtures |
| E2E | trainer sets accent → client sees branded plan (web+mobile) | Playwright + RN |

**Authorization negatives (mandatory RED tests)**:
- Client A cannot read Client B's data (userId filter = actor; B's assignment yields A only its own).
- Client cannot read beyond their assigned trainer's plans (single assignment row; other tenants denied).
- Revoked/invited assignment → `findByClientUserId` non-active → flat 403.
- No assignment (ordinary user) → 403; login/session byte-identical (assert `selectActiveTenant` unwired).
- Dashboard: trainer + client resolve to SAME tenant; no cross-tenant aggregation (req 3) — seed a decoy other-tenant session, assert excluded.

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. New HTTP routes are covered by the deny-by-default authorization negatives above.

## Migration / Rollout

No migration. Branding rides `plan_specs.spec_json` (back-compat: absent → base plan). New routes/DTO fields are inert if unused. #283 primitive is opt-in; revert removes the route with no data change.

## Slice Plan (chained, ~400-line budget each)

- **S1**: Dashboard read + `ClientDashboardDTO`/`RpeTrendPoint` + `computeRpeTrend` + `getClientDashboard` + tenant-safety tests. Independent (no #283 dep).
- **S2**: `resolveClientTrainerTenant` + `GET /me/trainer-plan` + `findLatestReadyByOwner` + full authz-negative suite (#283 mechanism).
- **S3**: `PlanSpec.branding` contract + validation + authoring wire in client-plan-create.
- **S4**: Branding render — web `--plan-accent`, mobile accent seam.
- **S5**: Client-facing branded-plan view wiring (consume S2 route in web/mobile client UI).

`Decision needed before apply: Yes` (chained PRs). `Chained PRs recommended: Yes`. `400-line budget risk: High` (5 slices; S2 is the highest-risk reviewable unit — isolate it).

## Open Questions

- [x] S5 client UI entry point (nav placement for trainer-plan view) — resolved during S5 implementation (web `/trainer-plan` route, mobile `TrainerPlanScreen`); not a blocking design gap at archive time.

## Shipped Mapping (added at archive)

| Slice | PR | Landed as |
|-------|-----|-----------|
| S1 | #285 | `GET /trainer/clients/:id/dashboard`, `ClientDashboardDTO`, `computeRpeTrend`, tenant-safe `getClientDashboard` |
| S2 | #286 | `resolveClientTrainerTenant`, `GET /me/trainer-plan` — resolves #283 |
| S3 | #287 | `PlanSpec.branding` on `spec_json` + hex validation + trainer authoring |
| S4 | #288 | Web `--plan-accent` CSS var + mobile accent seam + i18n |
| S5 | #289 | Web `/trainer-plan` + mobile `TrainerPlanScreen`, wired branding onto the response |
