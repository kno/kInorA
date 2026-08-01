# Delta for 15b-v2-trainer-dashboard-branding

## MODIFIED Requirements

### Requirement: Client Progress Dashboard

Trainers MUST be able to view assigned client progress, adherence, and workout history via `GET /trainer/clients/:clientUserId/dashboard`. The route MUST resolve the owner through `resolveAuthorizedOwner` before any repository call and MUST return a `ClientDashboardDTO` containing: `rpeTrend` (up to 8 weekly buckets over the last 8 UTC weeks, Monday-first; a bucket's `meanRpe` MUST be `null` when fewer than 2 rated working sets exist in that week), `completionRate` (rolling 28-day window; `percent = min(100, round(completed/planned*100))`), and `recentSessions` (last 5 completed sessions with `date`, `volumeKg`, `meanRpe` — `meanRpe` `null` when unrated).
(Previously: description referenced only completion rate, recent sessions, and RPE trends without a concrete route, DTO shape, aggregation window, or authorization mechanism.)

#### Scenario: View client adherence

- GIVEN a trainer with an active assignment to client A
- WHEN they call `GET /trainer/clients/A/dashboard`
- THEN the response includes completion rate, up to 5 recent sessions, and an RPE trend array

#### Scenario: RPE trend gap below sample floor

- GIVEN client A has fewer than 2 rated working sets in a given week within the trailing 8 weeks
- WHEN the dashboard is requested
- THEN that week's bucket has `meanRpe: null`

#### Scenario: Non-assigned client rejected

- GIVEN the caller is a trainer with no active assignment to client X
- WHEN they call `GET /trainer/clients/X/dashboard`
- THEN `resolveAuthorizedOwner` throws and the response is a flat 403 with no repository call

#### Scenario: Non-entitled trainer rejected

- GIVEN the caller has `role: "trainer"` but the active tenant's billing tier is not `trainer`
- WHEN they call the dashboard route for any client
- THEN `resolveAuthorizedOwner` throws and the response is a flat 403

### Requirement: Branded Plans

Trainers MAY set `PlanSpec.branding { trainerName?, title?, accentColor? }` at plan-creation time. `accentColor` MUST match `^#[0-9a-fA-F]{6}$` or the create request MUST be rejected with 400; `trainerName`/`title` MUST be capped at 60 characters. When present, branding MUST render on both the web client-facing plan view (via a CSS custom property) and the mobile client-facing plan view (via an accent prop). Absent branding MUST render the base (unbranded) plan.
(Previously: description mentioned custom branding with "colors" (plural) with no storage shape, validation, or rendering mechanism.)

#### Scenario: Branded plan appears to client

- GIVEN a trainer creates a plan with `branding: { trainerName: "Coach Ana", title: "Summer Cut", accentColor: "#1E90FF" }`
- WHEN the client opens the plan on web or mobile
- THEN the trainer name, title, and accent color are displayed

#### Scenario: Invalid accent color rejected

- GIVEN a trainer submits `accentColor: "blue"`
- WHEN the plan-create request is validated
- THEN the response is HTTP 400 and no plan is persisted

#### Scenario: Absent branding renders base plan

- GIVEN a plan has no `branding` field
- WHEN the client opens the plan
- THEN the plan renders with default (unbranded) styling

### Requirement: Tenant-Safe Dashboard Data

Trainer dashboards MUST NOT aggregate data from outside the active tenant. The trainer and the resolved client owner MUST share the same `tenantId` for the entire dashboard read; no cross-tenant session or metric MUST be included in the aggregation.
(Previously: unchanged behavioral intent; now stated against the concrete dashboard route and repository read.)

#### Scenario: Other tenant excluded

- GIVEN a trainer belongs to tenant A and a decoy completed session exists for the same client under tenant B
- WHEN dashboard metrics load for the tenant-A assignment
- THEN the tenant B session is excluded from all returned metrics

## ADDED Requirements

### Requirement: Client Read of Trainer-Owned Branded Plan

A client MUST be able to fetch their own latest ready plan living in an assigned trainer's tenant via `GET /me/trainer-plan`, using the `resolveClientTrainerTenant` authorization primitive (see `05b-v1-security-tenant-validation`). The returned plan MUST include `spec.branding` when set by the trainer.

#### Scenario: Client opens branded trainer plan

- GIVEN a client has an active assignment to a trainer whose tenant holds a ready plan owned by the client's `userId`, with branding set
- WHEN the client calls `GET /me/trainer-plan`
- THEN the response includes the plan and its branding, rendered with the trainer's accent color on web and mobile

## Out of Scope (explicit)

- Full color palette or multiple accent colors per plan.
- Logo upload.
- Multiple trainers per client.
- Historical backfill/analytics beyond the defined 8-week/28-day windows.
