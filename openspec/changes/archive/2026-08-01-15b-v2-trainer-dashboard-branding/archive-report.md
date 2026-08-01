# Archive Report: 15b-v2-trainer-dashboard-branding

**Status**: Archived (2026-08-01). SDD cycle complete. Full 3-requirement scope delivered and merged to main.

## Cycle Summary

Delivered the full locked scope in 5 chained slices, each merged to main via its own PR, all CI green at merge:

| Slice | PR | Content |
|-------|-----|---------|
| S1 | #285 | Trainer client-progress dashboard: `GET /trainer/clients/:id/dashboard` via `resolveAuthorizedOwner`; new `ClientDashboardDTO`; `computeRpeTrend` (8 weekly buckets, Monday-first, `meanRpe: null` below 2 rated sets); 28-day rolling completion rate; tenant-safe `getClientDashboard(tenantId, ownerUserId, now)`. |
| S2 | #286 | Resolution of issue #283: new deny-by-default `resolveClientTrainerTenant(ctx, deps)` client→trainer-tenant read primitive (`apps/api/src/trainer/client-access.ts`) + `GET /me/trainer-plan`. Login/session byte-identical for all users; `selectActiveTenant` remains unwired from `service.ts`/`social.ts`/`plugin.ts`. |
| S3 | #287 | `PlanSpec.branding { trainerName?, title?, accentColor? }` on `spec_json` (no new table/migration); hex-color boundary validation (`^#[0-9a-fA-F]{6}$`, else 400); 60-char caps on name/title; trainer authoring via existing client-plan-create route. |
| S4 | #288 | Branding rendering: web `--plan-accent` CSS custom property + mobile accent-only theming seam (new — `tokens.ts` had none before) + i18n for branding UI copy. |
| S5 | #289 | Client-facing branded-plan view: web `/trainer-plan` route + mobile `TrainerPlanScreen`, both consuming the S2 route and rendering the S3/S4 branding. |

Issue **#283** (the client-facing cross-tenant view gap deferred out of 15a) is **resolved and closed** by S2 — via a dedicated deny-by-default primitive, not by wiring `selectActiveTenant` into login (the design's rejected alternative, kept out to avoid a global tenant-switch blast radius on the core sign-in path for every dual-membership user).

## Verification Approach (no separate sdd-verify phase)

Per the launch prompt's authoritative final-state facts, verification for this change was CI-driven rather than a discrete `sdd-verify` phase artifact:

- CI green at each of the 5 merge points, covering contracts/api/web/mobile/i18n, plus real-Postgres billing integration, `pnpm architecture`, and `pnpm ui-api-guard`.
- Manual review of the S2 client-access authorization primitive (the highest-risk surface per the design's own risk register) was performed by the requesting engineer in addition to CI.
- No `sdd/15b-v2-trainer-dashboard-branding/verify-report` observation exists in Engram — confirmed via `mem_search`, zero results. This is consistent with the "no separate sdd-verify phase" fact; there is no stale verify-report to reconcile or rank against.

## Task Completion Gate

`openspec/changes/15b-v2-trainer-dashboard-branding/tasks.md` (source, pre-archive) showed all 33 implementation tasks across S1–S5 checked `[x]`, plus all `pnpm architecture` / `pnpm ui-api-guard` gate tasks per slice. No stale unchecked checkboxes found — no exceptional reconciliation was needed. The archived copy annotates each phase heading with its shipped PR number for traceability; content and checkbox state are otherwise unchanged from source.

The proposal's "Success Criteria" section (5 items) was still shown unchecked at archive time — these are outcome/acceptance-criteria checkboxes, not the governing implementation-tasks artifact (`tasks.md` is authoritative for the Task Completion Gate). Per the Final-State Authority hierarchy, they were marked complete in the archived `proposal.md` with an explicit archive-time note, since PRs #285–#289 (all merged, CI green) demonstrably satisfy all 5 stated criteria: trainer dashboard with completion rate/recent sessions/RPE trend (S1), tenant exclusion (S1/S3 tenant-safety tests), trainer-set branding visible client-side on web+mobile (S3/S4/S5), dual-membership client viewing the trainer-owned plan (S2/S5, resolves #283), and deny-by-default assignment-scoped client→trainer-tenant reads (S2).

## Spec Merge

### `openspec/specs/15b-v2-trainer-dashboard-branding/spec.md`
Roadmap placeholder superseded. Three requirements (`Client Progress Dashboard`, `Branded Plans`, `Tenant-Safe Dashboard Data`) replaced with the concrete MODIFIED versions from the delta (real route, DTO shape, aggregation windows, validation rules, authorization mechanism). One requirement (`Client Read of Trainer-Owned Branded Plan`) ADDED. `Out of Scope` section appended. `Purpose`/`Dependencies` header preserved unchanged.

### `openspec/specs/05b-v1-security-tenant-validation/spec.md`
One requirement ADDED: `Client-to-Trainer-Tenant Read Authorization` (the `resolveClientTrainerTenant` primitive, 5 scenarios: happy path, client-A-cannot-read-client-B, cannot-cross-into-unassigned-trainer, revoked/missing-assignment-denied, normal-user-self-only-and-login-unchanged). Appended after the existing `Actor-vs-Owner Authorization for Trainer Access` requirement (15a). All prior requirements (`Tenant Isolation Enforcement`, `Boundary Validation`, `Secure Defaults`, `Quota Privacy Boundary`, `Actor-vs-Owner Authorization for Trainer Access`) preserved verbatim — nothing removed or modified.

**Self-consistency check (explicitly requested)**: the resulting 05b main spec now states two independent deny-by-default read-authorization requirements that coexist without conflict:
- `Actor-vs-Owner Authorization for Trainer Access` (15a) governs **trainer→client** reads on trainer-scoped routes via `resolveAuthorizedOwner`; its "Self path unchanged for normal users" scenario keeps the plain self-only default intact for any request with no client parameter.
- `Client-to-Trainer-Tenant Read Authorization` (15b, this change) governs **client→trainer-tenant** reads on the new `/me/trainer-plan` route via `resolveClientTrainerTenant`; its own "Normal user self-only access and login unchanged" scenario independently reaffirms the same self-only default and explicitly asserts login/session byte-identity.
Both requirements are additive, apply to disjoint route families, and neither's scenarios contradict the other's. The two resolvers are intentionally NOT reused symmetrically (per the design's explicit rationale — `resolveAuthorizedOwner` widens trainer-into-client within one tenant; `resolveClientTrainerTenant` lets a client cross into a trainer's tenant reading only its own `userId`), so there is no shared-mechanism inconsistency to reconcile. Confirmed self-consistent.

## Archive Move

- Moved: `openspec/changes/15b-v2-trainer-dashboard-branding/` → `openspec/changes/archive/2026-08-01-15b-v2-trainer-dashboard-branding/` (date-prefix convention matched to existing archive entries).
- Archived contents: `proposal.md`, `exploration.md`, `design.md`, `tasks.md`, `specs/15b-v2-trainer-dashboard-branding/spec.md`, `specs/05b-v1-security-tenant-validation/spec.md`, this `archive-report.md`.
- **Tooling constraint**: this execution context has no shell/file-delete tool. The archive copies above were WRITTEN (not moved) to the archive path. **The orchestrator must run `git rm -r openspec/changes/15b-v2-trainer-dashboard-branding/` to complete the move** (delete the now-duplicated source directory); the archive copies are already in place and must NOT be deleted.

## Prod Follow-Ups (noted per launch-prompt guidance)

- Stripe live-mode webhook reachability remains an open go-live item from prior billing work (PR #254 / prod-deploy-env-and-billing memory) — unrelated to 15b's scope but noted here since it is a known outstanding prod gap at time of this archive.
- No 15b-specific prod follow-up issues were opened; #283 is fully closed, not partially deferred.

## Traceability (Engram Observation IDs)

| Artifact | Observation ID | Topic |
|----------|----------------|-------|
| proposal | 2492 | `sdd/15b-v2-trainer-dashboard-branding/proposal` |
| design | 2494 | `sdd/15b-v2-trainer-dashboard-branding/design` |
| spec | 2495 | `sdd/15b-v2-trainer-dashboard-branding/spec` |
| tasks | 2496 | `sdd/15b-v2-trainer-dashboard-branding/tasks` |
| verify-report | none — confirmed absent via `mem_search`, no separate sdd-verify phase per launch-prompt final-state facts | `sdd/15b-v2-trainer-dashboard-branding/verify-report` |
| archive-report | this document | `sdd/15b-v2-trainer-dashboard-branding/archive-report` |

## SDD Cycle Complete

The change has been fully planned, implemented (5 slices, all merged), verified (CI + manual review of the highest-risk slice), and archived. Issue #283 is resolved and closed. Ready for the next change (per user memory, next roadmap item is 14b adaptation-rpe-feedback).
