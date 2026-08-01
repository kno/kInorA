# Tasks: Trainer Dashboard & Branded Plans (15b v2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1500-1800 total (S1 ~350, S2 ~400, S3 ~250, S4 ~300, S5 ~250) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (S1) → PR2 (S2) → PR3 (S3) → PR4 (S4) → PR5 (S5) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (resolved for S1 apply run) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S1 | Dashboard read + `ClientDashboardDTO` + `computeRpeTrend` + tenant-safety | PR1 | `pnpm --filter @kinora/domain test rpe-trend` | supertest fake repos, `apps/api/src/routes/trainer.ts` | revert route + repo method, no data change |
| S2 | `resolveClientTrainerTenant` + `/me/trainer-plan` — highest risk | PR2 | `pnpm --filter @kinora/api test client-access` | supertest 2-tenant seeded fixtures | revert route + primitive, `selectActiveTenant` stays unwired |
| S3 | `PlanSpec.branding` contract + validation + authoring | PR3 | `pnpm --filter @kinora/contracts test` + `plan.ts` validation test | supertest plan-create 400 case | revert field, absent branding renders base plan |
| S4 | Branding render web CSS var + mobile accent seam | PR4 | `pnpm --filter web test PlanWeekView` / `pnpm --filter mobile test` | Playwright accent snapshot | revert render, base plan unaffected |
| S5 | Client-facing branded-plan view (consumes S2 route) | PR5 | e2e Playwright + RN | trainer sets accent → client sees branding | revert UI wiring only |

Rationale: S1 independently shippable (no #283 dep). S2 is the highest-risk security slice — isolate for focused review; S3-S5 depend on S2's route existing but S3/S4 are otherwise independent of each other; S5 depends on both S2 (route) and S4 (render).

## Phase S1: Trainer Dashboard Read

- [x] 1.1 RED: `packages/domain/src/progress/rpe-trend.test.ts` — 8-week bucket window, gap when <2 rated sets, Monday-first boundary
- [x] 1.2 GREEN: `packages/domain/src/progress/rpe-trend.ts` `computeRpeTrend`
- [x] 1.3 RED: completion-rate math test (28-day window, `percent = min(100, round(...))`)
- [x] 1.4 GREEN: implement completion-rate calc alongside `computeRpeTrend` call site
- [x] 1.5 Add `ClientDashboardDTO`, `RpeTrendPoint` to `packages/contracts/src/index.ts`
- [x] 1.6 RED: `workout-session.test.ts` — `getClientDashboard` tenant-safety (decoy other-tenant session excluded)
- [x] 1.7 GREEN: `apps/api/src/db/repositories/workout-session.ts` `getClientDashboard(tenantId, ownerUserId, now)`
- [x] 1.8 RED: route test — non-assigned client rejected (403, no repo call), non-entitled trainer rejected (403)
- [x] 1.9 GREEN: `GET /trainer/clients/:clientUserId/dashboard` in `apps/api/src/routes/trainer.ts` via `resolveAuthorizedOwner`
- [x] 1.10 Run `pnpm architecture` — confirm route uses injected repo interface, not direct import
- [x] 1.11 Run `pnpm ui-api-guard` (N/A, no web change this slice — confirm no-op pass)

## Phase S2: Client-to-Trainer-Tenant Read Authorization (#283)

- [x] 2.1 RED: revoked/missing assignment → `ForbiddenOwnerAccess` flat 403, no repo call
- [x] 2.2 RED: client A cannot read client B's data (filter always `ctx.actorUserId`)
- [x] 2.3 RED: client cannot read beyond assigned trainer (single-assignment resolution)
- [x] 2.4 RED: normal user self-only + login byte-identical (`selectActiveTenant` unwired assertion)
- [x] 2.5 GREEN: `apps/api/src/trainer/client-access.ts` `resolveClientTrainerTenant(ctx, deps)`
- [x] 2.6 RED: happy path — client reads own plan in trainer's tenant via `/me/trainer-plan`
- [x] 2.7 GREEN: `findLatestReadyByOwner` in `apps/api/src/db/repositories/workout-plan.ts`
- [x] 2.8 GREEN: `GET /me/trainer-plan` route in `trainer.ts`
- [x] 2.9 Verify zero diff in `service.ts`/`social.ts`/`plugin.ts` (self-only-unchanged proof)
- [x] 2.10 Run `pnpm architecture` — route uses injected `PlanRouteRepo`-style interface
- [x] 2.11 Run `pnpm ui-api-guard` (N/A this slice, API-only)

## Phase S3: Branding Data Model + Authoring

- [ ] 3.1 RED: `branding` accentColor regex rejection (400, no persist) + trainerName/title 60-char cap
- [ ] 3.2 GREEN: add `branding?` to `PlanSpec` in `packages/contracts/src/index.ts`
- [ ] 3.3 GREEN: validate `branding` in `apps/api/src/routes/plan.ts` client-plan-create
- [ ] 3.4 RED: absent branding persists/reads as undefined (base plan)
- [ ] 3.5 Run `pnpm architecture`

## Phase S4: Branding Rendering (Web + Mobile)

- [ ] 4.1 RED: web `PlanWeekView`/`PlanStatusView` render `--plan-accent` from `branding.accentColor`; absent → base token
- [ ] 4.2 GREEN: wire `style={{ "--plan-accent": accentColor }}` + CSS module fallback
- [ ] 4.3 RED: mobile `PlanWeekView`/`PlanStatusView` accent prop test; absent → `colors.<default>`
- [ ] 4.4 GREEN: thread `branding?.accentColor` prop through mobile plan screens
- [ ] 4.5 Run `pnpm architecture`
- [ ] 4.6 Run `pnpm ui-api-guard` — confirm web components import only client-safe branding types

## Phase S5: Client-Facing Branded-Plan View

- [ ] 5.1 RED: web e2e — client opens `/me/trainer-plan`, sees branded accent/title/trainerName
- [ ] 5.2 GREEN: wire web client UI to consume S2 route
- [ ] 5.3 RED: mobile RN test — same branded-view assertion
- [ ] 5.4 GREEN: wire mobile client UI to consume S2 route
- [ ] 5.5 Run `pnpm architecture`
- [ ] 5.6 Run `pnpm ui-api-guard` — verify server-only types not imported client-side; call via server action
