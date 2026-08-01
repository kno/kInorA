# Proposal: Trainer Dashboard & Branded Plans (15b v2)

## Intent

After 15a gave trainers scoped access to client data, trainers still cannot SEE client progress and cannot brand the plans they build. This change delivers the full 3-requirement roadmap slice: a trainer-facing client progress dashboard (multi-point metrics), trainer-branded plans visible to the client, and tenant-safe aggregation. Delivering req 2 requires resolving the deferred active-tenant/client-view gap (#283) so a client can actually open a plan living in the trainer's tenant.

## Scope

### In Scope
- Req 1: `GET /trainer/clients/:clientUserId/dashboard` reusing `resolveAuthorizedOwner`; new/extended metrics: RPE **multi-point trend series**, completion-rate over a defined period, richer recent-sessions list (date, volume, mean RPE). New/extended `ClientDashboardDTO`.
- Req 2: trainer branding = **trainer name + custom title + one accent color**, rendered on **both web and mobile**.
- Req 3: tenant-safe reads (trainer and client resolve to the same tenant on the read path).
- **#283 resolution** inside 15b: wire the active-tenant/client-view mechanism so a client reads the trainer-owned branded plan. Touches core auth/session.

### Out of Scope
- Full color palette / multiple accent colors, logo upload.
- Multiple trainers per client.
- Historical backfill/analytics beyond the defined dashboard window.

## Capabilities

### New Capabilities
- `trainer-client-dashboard`: trainer read of a client's multi-point progress metrics.
- `trainer-plan-branding`: name/title/accent branding authored by trainer, rendered web + mobile.
- `client-cross-tenant-plan-view`: assignment-scoped, deny-by-default client read into the trainer's tenant (resolves #283).

### Modified Capabilities
- `15b-v2-trainer-dashboard-branding`: satisfies all 3 roadmap requirements.

## Approach

- **Dashboard**: new trainer route resolves owner via `resolveAuthorizedOwner` (widening within trainer's own tenant, same shape as `plan.ts:790`), then a new/extended read for the multi-point series. New `ClientDashboardDTO`.
- **#283 / client view**: resolve the active-tenant mechanism — login-time tenant selection/switch (`selectActiveTenant` into `service.ts`/`social.ts`) vs. per-request assignment-scoped client read. This is a **NEW authorization path** (client crossing INTO trainer's tenant); `resolveAuthorizedOwner` is NOT symmetric and cannot be reused as-is. Must be deny-by-default and assignment-scoped, mirroring 15a's rigor.
- **Branding**: store on `PlanSpec` (mirrors `name`/`intensityBias`) vs. separate table — design decides. Render via CSS custom properties (web) and a NEW mobile theming seam (`tokens.ts` has no per-entity override today).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/routes/trainer.ts` | New | Trainer dashboard route |
| `apps/api/src/trainer/owner-access.ts` | Reused | Trainer-widening read auth |
| `apps/api/src/db/repositories/workout-session.ts` | Modified | Multi-point metrics extension |
| `packages/contracts/src/index.ts` | Modified | `ClientDashboardDTO`, `branding` on `PlanSpec` |
| `apps/api/src/auth/{service,social,tenant-selection}.ts` | Modified | #283 active-tenant/client-view (core auth) |
| `apps/web/.../plan/PlanWeekView.tsx`, `PlanStatusView.tsx` | Modified | Web branding render |
| `apps/mobile/src/theme/tokens.ts` + plan screens | New | Mobile per-plan theming seam |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **#283 touches core login/session** (highest-risk surface) | High | Isolate as its own reviewable step; keep behavior additive/opt-in; heavy tests on both login paths |
| **New client→trainer-tenant read authorization** (not covered by 15a resolver) | High | Deny-by-default, assignment-scoped, flat 403; mirror `resolveAuthorizedOwner` rigor; explicit design spec |
| RPE trend/completion window undefined | Med | Fix window/granularity in design |
| No mobile theming seam exists | Med | New minimal seam; accent-only keeps blast radius small |
| Large feature spanning chained slices | Med | Slice: dashboard+tenant-safety, then #283+client-view, then branding render |

## Rollback Plan

Feature is additive. Revert per slice: new routes/DTO fields are unused if reverted; branding field defaults to absent (renders base plan); #283 auth wiring is opt-in and can be reverted to single-membership login without data migration. No destructive migrations.

## Dependencies

- `15a-v2-trainer-account-access` (resolver, assignments, `selectActiveTenant`).
- 09c dashboard read path (`getDashboardSummary`).
- 14a/14b adherence + RPE domain (`computeAdherenceAdaptation`, `computeRpeAdaptation`).
- Issue #283 (active-tenant/client-view) — resolved here.

## Open Questions for Design

- Exact #283 mechanism: login-time tenant switcher vs. per-request assignment-scoped client read; shape of the client→trainer-tenant authorization path.
- RPE time-series window and granularity; completion-rate period definition; recent-sessions count.
- Branding storage location (`PlanSpec` vs. separate table).
- Mobile theming seam shape (CSS-var equivalent / context provider / inline).

## Success Criteria

- [x] Trainer opens client dashboard; sees completion rate, recent sessions, and multi-point RPE trend for an assigned client only.
- [x] Dashboard excludes any other-tenant client data (req 3).
- [x] Trainer sets name/title/accent; client opening the plan sees the branding on web AND mobile.
- [x] Client with dual membership can view the trainer-owned branded plan (#283 resolved).
- [x] Client→trainer-tenant read is deny-by-default and assignment-scoped (unauthorized returns flat 403).

> Archive note: all Success Criteria checkboxes updated from open to complete at archive time (2026-08-01) to reflect final shipped state across PRs #285–#289. See `archive-report.md` in this folder for per-slice evidence.
