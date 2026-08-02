# Archive Report: 16a-v3-gym-white-label

**Change**: `16a-v3-gym-white-label` (Gym White-Label Branding, v3)
**Archived**: 2026-08-02
**Status**: Fully implemented, merged to main across 5 chained slices, archived.

## Engram Artifact Traceability

| Artifact | Observation ID | Persisted |
|----------|-----------------|-----------|
| proposal | #2505 | 2026-08-01 23:37:48 |
| spec | #2508 | 2026-08-02 06:52:31 |
| design | #2507 | 2026-08-02 06:49:52 |
| tasks | #2509 | 2026-08-02 06:54:57 |
| verify-report | none found in Engram | n/a — see Verification section below |

No `sdd/16a-v3-gym-white-label/verify-report` observation exists in Engram.
Verification for this change was performed per-slice via CI on each of the 5
merged PRs (see below), not as a single consolidated SDD verify-report
artifact. This is recorded here rather than silently assumed.

## Slices Shipped (all merged to main)

| Slice | PR | Scope |
|-------|-----|-------|
| S1 | #300 | Schema: `gym` `BillingTier` value + `tenant_branding` table + migrations 0018/0019 + repository + hex-palette validator + `GYM_TIER_LIMITS` |
| S2 | #301 | Storage: `ObjectStoragePort` + `LocalStorageAdapter` + gated logo upload/serve routes |
| S3 | #302 | Security: gym-gated own-tenant branding CRUD + public unauthenticated read-by-slug |
| S4 | #303 | Login-page host-resolved inline-`<style>` theming |
| S5 | #304 | Whole-app rebrand via root-layout inline `<style>` |

Full scope was delivered as locked in the accepted proposal: subdomain-only
white-label, real logo file upload (not URL-only), full 6-field palette, new
additive `gym` billing tier, whole-app + login rebrand, tenant isolation on
every branding read/write.

## Verification Approach

- CI green at each of the 5 merges: contracts/api/web/i18n suites, real-Postgres
  billing integration tests, `pnpm architecture` (dependency-boundary gate),
  and `pnpm ui-api-guard` (web client/server-module boundary gate).
- Per the tasks.md gate checkpoints recorded during apply: S1 (`pnpm architecture`
  clean, full `apps/api` suite green), S2 (0 architecture violations across 1927
  modules/5706 deps, 125 files/1628 tests/11 skipped), S3 (0 architecture
  violations across 1931 modules/5728 deps, 128 files/1656 tests/12 skipped,
  including a real-Postgres integration test for the unique-slug-conflict path),
  S4 (`ui-api-guard` 40 client files/0 violations, `apps/web` 122 files/1158
  tests), S5 (`ui-api-guard` 40 client files/0 violations, `apps/web` 124
  files/1168 tests).
- Additional manual review (this archive cycle, per the orchestrator's launch
  prompt) of the S3 public read-by-slug endpoint (confirmed it returns only
  `logoUrl`+`palette`, no PII, no cross-tenant leak) and the CRUD tenant-scoping
  (confirmed every read/write is `WHERE tenantId = ?`-scoped and
  `assertGymEntitled`-gated).
- No consolidated `sdd-verify` phase output was found in Engram for this
  change; the above is reconstructed from the tasks.md gate annotations plus
  the launch prompt's explicit final-state facts, which are the
  highest-ranked available source per the Final-State Authority hierarchy.

## Design Directives Honored

- **Storage**: swappable `ObjectStoragePort` boundary interface + a concrete
  `LocalStorageAdapter` (infra-only, writes under `STORAGE_LOCAL_DIR`) — no
  caller depends on the concrete adapter; verified by `pnpm architecture`
  gates at S2/S3.
- **Theming**: on-the-fly CSS via server-rendered inline `<style>` (not a
  cacheable `text/css` route) — `var(--gym-x, var(--default))` fallback used
  consistently pre-auth (login, S4) and post-auth (root `(app)` layout, S5),
  giving automatic default-branding fallback with zero JS branching.
- **Billing gating**: `gym` tier added additively to `billingTierEnum` via
  `ALTER TYPE ... ADD VALUE` (own migration file, separate transaction from
  the `tenant_branding` table creation — same gotcha 15a hit), gated by a
  new tier-only `assertGymEntitled`/`ForbiddenGymAccess` helper (no `"gym"`
  role exists in `MembershipRole`; this gate checks tier only, unlike
  `assertTrainerEntitled` which also checks role).

## OPEN OPS PREREQUISITES (delivery-blocking, not code — tracked prominently)

1. **Prod `STORAGE_LOCAL_DIR` mount path**: the production `STORAGE_LOCAL_DIR`
   MUST be mounted under the VPS deploy volume
   (`/mnt/blockvolume/homes/kinora/deploy/...`) OUTSIDE the container image,
   or every uploaded gym logo is LOST on the next redeploy. This is an ops
   action outside this repo and was NOT verified as done during this SDD
   cycle. Must be confirmed/actioned before any gym customer uploads a real
   logo in production.
2. **Reverse-proxy wildcard subdomain routing**: `*.kinora.aitsai.com → web`
   routing is external infra (nginx/Caddy/reverse-proxy config), lives
   outside this repository, and was NOT verified as configured. This blocks
   true end-to-end subdomain testing (a real gym visiting
   `gymname.kinora.aitsai.com` in production) regardless of the app-level
   correctness already proven by forced-`Host`-header integration tests.

## DEFERRED (explicit non-goal, tracked for follow-up)

- **Admin UI for assigning the `gym` tier + `subdomainSlug`**: this change
  ships API/provisioning-only tier and slug assignment (reusing the existing
  admin-override path for tier; slug is set on first branding upsert,
  unique-indexed). No admin UI screen was built. File a follow-up issue if
  an admin UI is wanted.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `16a-v3-gym-white-label` | Superseded placeholder | 3 roadmap requirements replaced with concrete behavior (`assertGymEntitled` gating, hex-validated 6-field palette, `var(--gym-x, var(--default))` fallback, tenant-scoped public read); 3 new requirements added (Logo Upload via Storage Abstraction, Public Subdomain Branding Resolution, Whole-App Rebrand After Login); Non-Goals section added; Dependencies expanded to name `01c`, `05b`, `11a` explicitly alongside `15b`. |
| `11a-v1-billing-plans-tiers` | Modified | "Plan Tiers" requirement full-block replaced to add `gym` to the tier enum/prose and one new scenario ("Gym tier gates branding management"); the closing Note extended to explicitly distinguish `trainer` (15a role gate) from `gym` (16a branding gate) — both tiers now coexist coherently in one requirement, confirmed self-consistent (see below). |

### 11a main spec self-consistency confirmation

The updated `openspec/specs/11a-v1-billing-plans-tiers/spec.md` "Plan Tiers"
requirement now names four tiers (`free`, `pro`, `trainer`, `gym`) in its
opening sentence, gives `trainer` and `gym` each their own sentence describing
what they gate (`trainer` = metered-cap tier gating the 15a trainer ROLE
capability; `gym` = same metered caps as `pro` by default, gating only the
16a branding-management capability via `assertGymEntitled`), includes a
scenario for each, and closes with a Note explicitly stating they are
independent additive dimensions that do not alter each other. No contradiction
found between the pre-existing `trainer` scenarios and the newly added `gym`
scenario.

## Archive Contents

- `proposal.md` (present)
- `design.md` (present)
- `exploration.md` (present)
- `specs/16a-v3-gym-white-label/spec.md` (present, delta — merged into main spec)
- `specs/11a-v1-billing-plans-tiers/spec.md` (present, delta — merged into main spec)
- `tasks.md` (present — all 5 implementation phases fully checked `[x]`;
  Phase 6 cleanup items 6.1/6.2 marked `[x]` and annotated as completed
  during THIS archive cycle, since they describe archive-time actions)

## Source of Truth Updated

- `openspec/specs/16a-v3-gym-white-label/spec.md`
- `openspec/specs/11a-v1-billing-plans-tiers/spec.md`

## Filesystem Move — ACTION REQUIRED BY ORCHESTRATOR

This executor has no shell/delete tool available. The archive copies above
were WRITTEN to
`openspec/changes/archive/2026-08-02-16a-v3-gym-white-label/` (proposal.md,
design.md, exploration.md, tasks.md, specs/16a-v3-gym-white-label/spec.md,
specs/11a-v1-billing-plans-tiers/spec.md, this archive-report.md).

**The orchestrator MUST now run**:
```
git rm -r openspec/changes/16a-v3-gym-white-label/
```
to remove the original (now-duplicated) source directory
`openspec/changes/16a-v3-gym-white-label/` so the change is not left active
in two places. Do NOT delete the newly written archive copy.

## SDD Cycle Complete

The change has been fully planned, implemented (5 chained PRs, #300-#304),
verified (per-slice CI + this cycle's manual security review), and archived.
Two ops prerequisites and one deferred admin-UI item remain open and are
recorded above — they do not block archival, only production rollout, and
should be tracked as follow-up issues/ops tasks.
