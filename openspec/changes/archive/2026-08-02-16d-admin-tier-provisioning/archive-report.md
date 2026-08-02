# Archive Report: 16d — Admin Tier Provisioning

**Change ID**: `16d-admin-tier-provisioning`  
**GitHub Issue**: #307  
**Archive Date**: 2026-08-02  
**Artifact Store Mode**: openspec  
**Status**: ARCHIVED

## Executive Summary

Change `16d-admin-tier-provisioning` (superadmin-gated grant and revoke of `trainer`/`gym` billing tier via `tenant_billing_overrides`) has been successfully IMPLEMENTED, VERIFIED, and ARCHIVED. The feature shipped in PR #312 (squash commit `ee63a7b`, "feat(billing): superadmin tier-grant provisioning via billing overrides (#307)") and passed comprehensive verification with zero test failures and zero architecture violations. The main spec has been merged into `openspec/specs/16d-admin-tier-provisioning/spec.md`. Three non-blocking follow-ups (#313, #314, #315) remain open for future work. The SDD cycle is complete.

## Final State Authority

Per the Final-State Authority hierarchy in `sdd-archive/SKILL.md`:

1. **Native review authority** (if applicable): Not applicable — review gate not enforced in launch context.
2. **Tasks artifact** (authoritative completion): All 41 implementation tasks in `tasks.md` are marked complete (`[x]`).
3. **Launch prompt final-state facts** (explicit facts from orchestrator): Implementation SHIPPED and MERGED as PR #312 with two fixes applied and merged (UUID validation + transaction-scoped `pg_advisory_xact_lock`). Full verification: 1685 tests passed, 0 failed; architecture check: 0 violations; TypeScript: clean. Three non-blocking follow-ups filed.
4. **Intermediate snapshots** (`verify-report`, `apply-progress`): Not consulted for this report; launch facts supersede.

## Implementation & Verification

### Code Changes Summary

**Files Created**:
- `apps/api/src/billing/tier-override-admin.ts` — `TierOverrideAdminPort`, `GrantTenantTierOverride`, `RevokeTenantTierOverride` use-cases
- `apps/api/src/db/repositories/tier-override-admin.ts` — transactional `TierOverrideAdminRepository` adapter (grant/revoke + audit)
- `apps/api/src/routes/admin-tier-override.ts` — superadmin-gated HTTP routes (narrow port, zero db/* imports)
- `apps/api/drizzle/0020_billing_audit_actor_fk.sql` — migration relaxing `billingAuditEvents.actorUserId` FK to plain `users.id`
- Multiple test files (tier-override-admin.test.ts, tier-override-admin.integration.test.ts, tier-override-composition.integration.test.ts, admin-tier-override.test.ts)

**Files Modified**:
- `apps/api/src/db/schema.ts` — drop `actorMembershipFk`, add `.references(()=>users.id)` on `actorUserId`
- `apps/api/src/app.ts` — register `adminTierOverrideRoutes` with repo adapter near line 495

### Verification Results (per launch prompt final-state facts)

**Test Suite**: Full `pnpm --filter api test` hermetic + real-Postgres combined = **1685 passed, 0 failed**  
**Architecture Check**: `pnpm architecture` = **0 violations**  
**TypeScript**: `tsc --noEmit` = **clean**  
**Code Review**: Two-judge adversarial review completed. No CRITICAL findings. Two fixes applied and merged in same PR:
1. UUID validation on `:tenantId` path param (422 on malformed, not 500)
2. Grant overlap race closed with transaction-scoped `pg_advisory_xact_lock`

### Scope Completion

All 6 phases complete:

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Migration (audit FK relaxation, backward-compatible) | ✅ Complete, 4 tasks |
| 2 | Use-Cases (grant/revoke logic, validation, overlap guard) | ✅ Complete, 16 tasks |
| 3 | Transactional Adapter (real-Postgres integration, audit writes) | ✅ Complete, 6 tasks |
| 4 | 16c Composition (override tier orthogonal to seat billing) | ✅ Complete, 2 tasks |
| 5 | Admin Route (HTTP endpoint, gating, error mapping) | ✅ Complete, 10 tasks |
| 6 | App Wiring + Cleanup | ✅ Complete, 3 tasks |

**Total tasks**: 41/41 complete (100%)

## Spec Sync & Archive

### Main Spec Created

New capability spec merged into main openspec:

**Path**: `openspec/specs/16d-admin-tier-provisioning/spec.md`  
**Size**: 8 requirements, 27 scenarios (full spec, not a delta)

### Change Folder Archived

**Source**: `openspec/changes/16d-admin-tier-provisioning/`  
**Destination**: `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning/`

**Contents**:
- ✅ exploration.md
- ✅ proposal.md
- ✅ design.md
- ✅ tasks.md
- ✅ specs/16d-admin-tier-provisioning/spec.md
- ✅ archive-report.md (this file)

## Follow-Up Issues

Three non-blocking follow-ups remain open:

| Issue | Title | Scope |
|-------|-------|-------|
| #313 | Grant idempotency key | Deferred: add idempotency token to prevent duplicate grants from concurrent retries |
| #314 | Grant-after-revoke dedicated integration test | Deferred: add focused e2e test for revoke → immediate re-grant sequence |
| #315 | Concurrent-revoke duplicate audit row | Deferred: add guard against concurrent revokes creating multiple `admin_override_expired` rows for same override |

None of these are blockers; all shipped capability is stable and production-ready.

## Deliverables & Traceability

### Artifact Store (openspec mode)

| Artifact | Location | Type |
|----------|----------|------|
| Exploration | `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning/exploration.md` | SDD Phase 1 |
| Proposal | `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning/proposal.md` | SDD Phase 2 |
| Design | `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning/design.md` | SDD Phase 3 |
| Tasks | `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning/tasks.md` | SDD Phase 4 (41/41 complete) |
| Main Spec | `openspec/specs/16d-admin-tier-provisioning/spec.md` | Source of truth (synced from delta) |
| Archive Report | `openspec/changes/archive/2026-08-02-16d-admin-tier-provisioning/archive-report.md` | SDD Phase 5 (this file) |

### Change Tracking

- **GitHub PR**: #312 (merged to main)
- **Commit**: ee63a7b (squash)
- **Issue**: #307 (closed by PR #312)
- **Review**: Two-judge adversarial review, zero CRITICAL, two fixes applied in same PR

## Risks & Decisions

### Completed Risks (All Mitigated)

| Risk | Likelihood (Pre) | Mitigation | Status |
|------|--------|-----------|--------|
| Migration on shared audit table | Medium | Additive-only, backward compatible; regression test on `writeMemberAllocation` passed | ✅ Verified |
| Overlapping active overrides | Low | App-level guard now; constraint deferred (follow-up #315 covers concurrent-revoke edge) | ✅ Verified |
| Mixed tier/status display | Low | Documented/accepted; UI in #306 | ✅ Deferred (out of scope) |

### Architectural Decisions (Final)

1. **Audit FK**: Approach B (relaxed to plain `users.id`) — approved by proposal decision round, implemented additively, backward-compatible.
2. **Open-ended grant**: Far-future sentinel `endsAt = 9999-12-31T00:00:00Z` — satisfies NOT NULL constraint, stable in active-override query.
3. **Revoke**: `UPDATE endsAt=now() + admin_override_expired` audit — preserves audit trail, never DELETE.
4. **Overlap guard**: Application-level 409 rejection when active override exists — explicit superadmin action, safe against concurrent grants (fixed with transaction-scoped lock).
5. **16c composition**: Override is tier-authoritative; `seatCount` is orthogonal — verified, no coupling to price-to-tier mapping.

## Closure Notes

- **SDD Cycle**: Complete. All phases from Exploration through Verification have been delivered, reviewed, merged, and are now archived.
- **Rollback plan**: Revert route registration + use-case/adapter files; migration is additive and may stay or roll back separately.
- **Production readiness**: Code is shipped, tested, and stable. Non-blocking follow-ups are enhancements, not fixes.
- **Backward compatibility**: Audit FK migration is backward-compatible; all existing `writeMemberAllocation` flows continue to work unchanged.

## Archive Seal

This archive report closes the SDD cycle for `16d-admin-tier-provisioning`. The feature has shipped (PR #312, commit ee63a7b), is verified (1685/1685 tests passed, 0 violations), and is now archived pending future follow-up work on idempotency, regression testing, and edge-case guard improvements.

---

**Archived**: 2026-08-02  
**By**: SDD Archive Executor  
**Artifact Store**: openspec
