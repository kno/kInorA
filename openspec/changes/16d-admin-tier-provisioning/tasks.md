# Tasks: 16d — Admin Tier Provisioning

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600–650 (non-test ~320, tests ~300+) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (fallback if >800 in review: Slice A = migration+adapter+integration test; Slice B = use-cases+route+unit/route tests) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Full vertical slice: migration + use-cases + adapter + route + app wiring | PR 1 | `pnpm --filter @kinora/api test tier-override-admin` | Real-Postgres integration suite (`pnpm --filter @kinora/api test:integration`) | Revert route registration + use-case/adapter files; migration may stay (additive, no data yet) |

## Phase 1: Migration (Foundation)

- [x] 1.1 RED: assert `billingAuditEvents.actorUserId` FK is plain `users.id` (fails against current composite FK) — `apps/api/src/db/__tests__/schema-billing-audit-fk.test.ts`
- [x] 1.2 GREEN: edit `apps/api/src/db/schema.ts` — drop `actorMembershipFk`, add `.references(()=>users.id)` on `actorUserId`
- [x] 1.3 Hand-crafted `apps/api/drizzle/0020_billing_audit_actor_fk.sql` + `_journal.json` entry (DEVIATION: `drizzle-kit generate` diffed against the stale `0011_snapshot.json` — meta/ has NO snapshots for 0012-0019, matching this repo's established pattern of hand-written migrations since 0012 — so `generate` would have replayed already-applied 0012-0019 DDL. Applied via `drizzle-kit migrate` against local Postgres; confirmed clean.)
- [x] 1.4 Verify `billing-schema.test.ts:176` (0011 migration text assertion) still passes unaffected

## Phase 2: Use-Cases (Core)

- [x] 2.1 RED: grant happy path — sentinel `endsAt`, `admin_override_created` audit — `apps/api/src/billing/tier-override-admin.test.ts`
- [x] 2.2 GREEN: create `apps/api/src/billing/tier-override-admin.ts` — `TierOverrideAdminPort`, `GrantTenantTierOverride`
- [x] 2.3 RED: grant rejects unknown tenant (404)
- [x] 2.4 GREEN: implement tenant-lookup branch
- [x] 2.5 RED: grant rejects when active override exists (409 overlap)
- [x] 2.6 GREEN: implement overlap-guard branch
- [x] 2.7 RED: grant rejects `tier: "pro"`/`"free"`
- [x] 2.8 GREEN: implement tier enum validation
- [x] 2.9 RED: grant rejects empty/missing `reason`
- [x] 2.10 GREEN: implement reason validation
- [x] 2.11 RED: grant rejects `endsAt <= startsAt`
- [x] 2.12 GREEN: implement date-range validation
- [x] 2.13 RED: revoke happy path — `endsAt=now`, `admin_override_expired` audit
- [x] 2.14 GREEN: implement `RevokeTenantTierOverride`
- [x] 2.15 RED: revoke rejects when no active override (409)
- [x] 2.16 GREEN: implement no-active-override branch

Note: `admin_override_created`/`admin_override_expired` audit writes are the
transactional ADAPTER's responsibility (Phase 3) — the pure use-case only
calls `port.grantTierOverride`/`port.revokeTierOverride`; the fake port in
this unit suite proves the CALL, not the audit row (that's covered by the
Phase 3 integration test).

## Phase 3: Transactional Adapter (Integration, real-Postgres)

- [x] 3.1 RED: non-member superadmin grant writes override+audit against relaxed FK — real-Postgres suite (mirror `billing-admin.integration.test.ts`)
- [x] 3.2 GREEN: create `apps/api/src/db/repositories/tier-override-admin.ts` — `TierOverrideAdminRepository` (tx grant/revoke, `loadTenant`, `loadActiveOverride`)
- [x] 3.3 RED: revoke updates `endsAt` + writes `admin_override_expired` audit
- [x] 3.4 GREEN: implement `revokeTierOverride`
- [x] 3.5 RED: regression — `writeMemberAllocation` audit insert unaffected by relaxed FK
- [x] 3.6 GREEN: confirm passes with no production code change (migration backward-compat) — verified in the SAME suite (`tier-override-admin.integration.test.ts`), all 3 real-Postgres tests green (DATABASE_URL=postgres://kinora:kinora@localhost:5432/kinora)

## Phase 4: 16c Composition Contract (Integration)

- [x] 4.1 RED→GREEN: active `trainer` override + `tenant_billing_states` row → `loadContext`/`resolveEffectiveTier` returns `trainer`, billing-state metadata intact — `apps/api/src/db/repositories/__tests__/tier-override-composition.integration.test.ts` (DEVIATION: `seatCount` doesn't exist yet — 16c hasn't shipped that column — used `stripeSubscriptionId` as the orthogonal-metadata stand-in; same contract proven)
- [x] 4.2 GREEN: confirmed existing precedence in `resolveEffectiveTier`/`BillingStateReaderRepository.loadContext` already handles this correctly — NO production code change needed. (Found & fixed a TEST-ONLY gotcha: `loadContext` resolves its active-override window against real wall-clock `new Date()`, not an injected instant, so the test seeds `startsAt` in the recent past rather than a fixed future-dated constant.)

## Phase 5: Admin Route (Wiring)

- [x] 5.1 RED: `POST /admin/tenants/:tenantId/tier-override` returns 403 for non-admin — mirror `admin-ai-config` route test
- [x] 5.2 GREEN: create `apps/api/src/routes/admin-tier-override.ts` — narrow `AdminTierOverrideRouteRepo` port, zod schema, `requireAuth`+`requireAdmin`; zero `db/*` import
- [x] 5.3 RED: admin grant returns 201
- [x] 5.4 GREEN: wire grant handler to `GrantTenantTierOverride`
- [x] 5.5 RED: overlap returns 409 via route
- [x] 5.6 GREEN: map overlap outcome to 409
- [x] 5.7 RED: invalid body returns 422
- [x] 5.8 GREEN: map zod failure to 422
- [x] 5.9 RED: revoke route returns 200 success / 409 no-active-override
- [x] 5.10 GREEN: add `POST .../tier-override/revoke` handler wired to `RevokeTenantTierOverride`
- All 9 route tests written together in `admin-tier-override.test.ts` (403/201/404/409/422 grant + 403/200/409 revoke), confirmed RED (module not found) before GREEN.

## Phase 6: App Wiring / Cleanup

- [x] 6.1 Wire adapter + route port in `apps/api/src/app.ts`; `app.register(adminTierOverrideRoutes, { repo })` right after `adminAiConfigRoutes` (near former line 495)
- [x] 6.2 Confirm dep-cruiser `routes-no-db-layer` passes for `admin-tier-override.ts` — `pnpm architecture` green (1939 modules, 5764 deps, 0 violations)
- [x] 6.3 Resolve open question: grep confirms no LIVE-schema snapshot asserts the composite audit FK — only the immutable 0011 migration-text assertion (`billing-schema.test.ts:177`, unaffected — pinned to migration 0011 text, not current schema) and the historical `0011_snapshot.json`. No update needed.

## Final Verification

- `pnpm --filter api test` (hermetic, no DATABASE_URL): 133 files, 1619 passed, 76 skipped — 0 failures
- `DATABASE_URL=postgres://kinora:kinora@localhost:5432/kinora pnpm --filter api test`: 133 files, 1681 passed, 14 skipped (real-postgres describe.skipIf stubs) — 0 failures
- `pnpm exec tsc --noEmit` (apps/api): no errors
- `pnpm architecture`: 0 dependency violations; negative guard passed
- Baseline safety net before any change: 128 files / 1596 passed / 72 skipped — all green, confirming no pre-existing failures were masked
