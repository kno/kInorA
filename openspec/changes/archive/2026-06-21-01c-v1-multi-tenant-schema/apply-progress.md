# Apply Progress: 01c-v1-multi-tenant-schema

## Status: Complete

All 19 tasks completed. All verification commands pass.

## Completed Tasks

### Phase 1: Dependencies & Infrastructure
- [x] 1.1 Added `drizzle-orm`, `pg`, `drizzle-kit` (dev), `@types/pg` to `apps/api/package.json`; added `db:generate` and `db:migrate` scripts
- [x] 1.2 Created `apps/api/drizzle.config.ts`
- [x] 1.3 Created `apps/api/src/db/client.ts` with PostgreSQL pool factory and Drizzle client

### Phase 2: Schema & Migration (TDD)
- [x] 2.1 RED: Schema shape test with 15 assertions in `apps/api/src/tenant/__tests__/schema.test.ts`
- [x] 2.2 GREEN: `apps/api/src/db/schema.ts` with tenants, users, memberships, UUIDs, timestamps, enums, unique index
- [x] 2.3 Generated first migration in `apps/api/drizzle/0000_giant_madripoor.sql`

### Phase 3: Tenant Context & Contracts (TDD)
- [x] 3.1 RED: Tenant context rejection test with 7 assertions in `apps/api/src/tenant/__tests__/tenant-context.test.ts`
- [x] 3.2 GREEN: `apps/api/src/tenant/tenant-context.ts` with `TenantQueryContext` and `assertTenantContext()`
- [x] 3.3 Updated `packages/contracts/src/index.ts` — branded `TenantId`, `UserId`, `MembershipId`, `TenantQueryContextDTO`, `MembershipRole`, `MembershipStatus`

### Phase 4: Provisioning & Repositories (TDD)
- [x] 4.1 RED: Provisioning test with 4 assertions in `apps/api/src/tenant/__tests__/provisioning.test.ts`
- [x] 4.2 GREEN: `apps/api/src/tenant/provisioning.ts` with `provisionTenantForUser()`
- [x] 4.3 RED: Repository context rejection test with 5 assertions in `apps/api/src/tenant/__tests__/repositories.test.ts`
- [x] 4.4 GREEN: `apps/api/src/tenant/repositories.ts` with `TenantRepository`

### Phase 5: Architecture Guards
- [x] 5.1 Updated `scripts/deps-guard.mjs` — DB packages allowed in apps/api only
- [x] 5.2 Updated `.dependency-cruiser.cjs` — contracts DB-package ban, API infra-layer DB allowlist
- [x] 5.3 Updated `package.json` architecture script to include `apps/api/src`

### Phase 6: Verification
- [x] 6.1 All verification commands pass (test, type-check, deps-guard, architecture, build)
- [x] 6.2 Membership enums: `owner`/`member` and `invited`/`active`/`suspended` confirmed
- [x] 6.3 PostgreSQL test harness: unit tests with mocks for now; Docker Compose integration deferred

## Verification Results

| Command | Result |
|---------|--------|
| `pnpm --filter api test` | ✅ 40 tests passing |
| `pnpm --filter api type-check` | ✅ No errors |
| `pnpm deps-guard` | ✅ All clean |
| `pnpm architecture` | ✅ No violations (592 modules cruised) |
| `pnpm build` | ✅ All workspaces build |
| `pnpm --filter @kinora/domain test` | ✅ 3 tests passing |
| `pnpm --filter @kinora/contracts type-check` | ✅ No errors |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1–2.2 | `schema.test.ts` | Unit | N/A (new) | ✅ Written | ✅ 15/15 pass | ✅ 15 cases covering all tables/columns/types | ✅ Clean |
| 3.1–3.2 | `tenant-context.test.ts` | Unit | N/A (new) | ✅ Written | ✅ 7/7 pass | ✅ null, undefined, empty string, valid, valid+userId | ✅ Clean |
| 4.1–4.2 | `provisioning.test.ts` | Unit | N/A (new) | ✅ Written | ✅ 4/4 pass | ✅ 3 cases (basic, different IDs, no auth info) | ✅ Clean (added undefined checks) |
| 4.3–4.4 | `repositories.test.ts` | Unit | N/A (new) | ✅ Written | ✅ 5/5 pass | ✅ null context, valid context, empty string | ✅ Clean |

## Test Summary
- **Total tests written**: 31 (15 schema + 7 tenant-context + 4 provisioning + 5 repositories)
- **Total tests passing**: 40 (31 new + 9 existing)
- **Layers used**: Unit (31)
- **Approval tests (refactoring)**: None — no refactoring tasks
- **Pure functions created**: 1 (`assertTenantContext`)

## Deviations from Design

- `client.ts` uses `PoolConfig` from `pg` for testability — aligns with design's "PostgreSQL pool factory" intent
- Task 6.3 (PostgreSQL test harness): used unit tests with mocks instead of integration tests with Docker Compose. Integration test harness is deferred to when a real DB connection is needed (e.g., 05a auth-core)
- Provisioning uses array indexing with undefined checks instead of destructuring — required by TypeScript strict mode with `noUncheckedIndexedAccess`

## Issues Found

None — all verification commands pass clean.

---

## Remediation (post-verify CRITICAL fixes)

After strict verify (`verify-report.md`) surfaced two CRITICAL correctness gaps, a
remediation apply batch was executed under the same Strict TDD discipline. Only the
CRITICAL issues were touched; no scope expansion.

### CRITICAL fixes addressed

1. **Tenant-scoped `findTenantById`**: the previous implementation validated only
   that *some* context existed, then queried by the arbitrary `id` argument
   (`where(eq(tenants.id, id))`), allowing a caller with valid context for tenant A
   to fetch tenant B by id. Fixed by introducing `assertTenantIdMatchesContext`,
   which is called BEFORE persistence and verifies `id === ctx.tenantId`. The
   subsequent Drizzle predicate also uses `ctx.tenantId` so persistence is now
   tenant-scoped at runtime.
2. **Repository test evidence for tenant scoping**: replaced the prior
   valid-context test (which used mismatched ctx.tenantId/id) with cases that
   prove scoping at runtime — a matching case that returns the row, a mismatch
   case that throws before persistence, plus triangulation cases and a
   row-not-found case returning null.
3. **Contracts DB import guard** (`pnpm architecture` silently accepted a `pg`
   import from `packages/contracts/src`): added the `contracts-no-outer-npm-
   unresolvable` dependency-cruiser rule, analogous to the existing domain rule,
   so unresolvable third-party npm imports in contracts are rejected.
4. **Negative guard regression check**: added `scripts/architecture-negative-
   test.mjs` and wired it into the root `pnpm architecture` script so a
   regression of either the contracts or domain DB import ban is caught
   permanently.

### Strict TDD cycle for the remediation

Safety net (before any modification): `pnpm --filter api test` → 40/40 passing.

RED: added 8 new tests for `assertTenantIdMatchesContext` in
`tenant-context.test.ts` (referencing a function that did not exist) and
replaced/augmented `repositories.test.ts` with a mismatch test that throws
before persistence. `pnpm --filter api test` → **9 failures, RED confirmed**.

GREEN: implemented `assertTenantIdMatchesContext` in `tenant-context.ts` and
updated `repositories.ts` to call it and to scope the predicate to
`ctx.tenantId`. `pnpm --filter api test` → **51/51 passing**.

Triangulation: match + mismatch (both directions) + different valid IDs +
missing id (`undefined`, empty string) + delegated context validation
(null/empty ctx), plus a row-not-found `null` case and a different valid ctx
match in the repository tests.

REFACTOR: removed the now-unused `and` import from `repositories.ts`; helper
JSDoc and doc comment on `TenantRepository` updated to document the
tenant-scope invariant. Tests remain green.

For the architecture guard:

RED: wrote `scripts/architecture-negative-test.mjs` that programmatically
writes a temporary violating probe file under each inner layer's `src` dir,
runs `depcruise` against it, and asserts the run is rejected. Without the new
rule, `node scripts/architecture-negative-test.mjs` → ❌ contracts probe NOT
rejected (RED confirmed).

GREEN: added `contracts-no-outer-npm-unresolvable` to `.dependency-cruiser.cjs`
and extended the root `architecture` script to also run the negative guard.
`node scripts/architecture-negative-test.mjs` → ✅ both probes rejected.

### Files Changed (remediation batch)

| File | Action | What was done |
|------|--------|---------------|
| `apps/api/src/tenant/tenant-context.ts` | Modified | Added pure `assertTenantIdMatchesContext(ctx, id)` helper with JSDoc documenting the tenant-scoping contract. |
| `apps/api/src/tenant/repositories.ts` | Modified | `findTenantById` now calls `assertTenantIdMatchesContext` before persistence and scopes the Drizzle predicate to `ctx.tenantId`; dropped unused `and` import; refreshed doc comments. |
| `apps/api/src/tenant/__tests__/tenant-context.test.ts` | Modified | Added 8 tests for `assertTenantIdMatchesContext` (match, mismatch both directions, different IDs, missing id, delegated context validation). |
| `apps/api/src/tenant/__tests__/repositories.test.ts` | Modified | Replaced mismatched-id "valid context" test with a matching scoped test, a mismatch-fails-before-persistence test, a triangulation case with a different valid ctx, and a row-not-found `null` case. |
| `.dependency-cruiser.cjs` | Modified | Added `contracts-no-outer-npm-unresolvable` rule mirroring the domain rule, so source-level DB imports in `packages/contracts/src` are rejected by `pnpm architecture` even when not resolvable. |
| `scripts/architecture-negative-test.mjs` | Created | Permanent regression guard: writes a temporary `pg` import in `packages/contracts/src` and `drizzle-orm` import in `packages/domain/src`, runs `depcruise`, asserts both are rejected, and cleans up. |
| `package.json` | Modified | Extended `architecture` script to also run `node scripts/architecture-negative-test.mjs` after depcruise so the negative guard is part of `pnpm architecture`. |

### Remediation TDD Cycle Evidence

| Work Unit | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|-----------|-------|------------|-----|-------|-------------|----------|
| `assertTenantIdMatchesContext` pure function | Unit | ✅ 40/40 before | ✅ Written (import of nonexistent fn → 8 + 1 failures) | ✅ 51/51 after implementation | ✅ match, mismatch (both directions), different IDs, missing id, empty-id, delegated null/empty ctx | ✅ Clean (removed unused import) |
| `TenantRepository.findTenantById` tenant-scoped query | Unit | ✅ 40/40 before | ✅ Mismatch test fails before implementation (test + impl untouched) | ✅ 51/51 after implementation | ✅ Matching case, mismatch-fails-before-persistence, different valid ctx, row-not-found | ✅ Dropped unused `and` import; doc comments refreshed |
| Architecture negative guard (`contracts-no-outer-npm-unresolvable`) | Architecture | ✅ `pnpm architecture` clean before | ✅ Negative guard script flagged contracts probe as NOT rejected | ✅ Both probes rejected after new rule + script wired into `pnpm architecture` | ➖ Single capability scenario (config rule); triangulation skipped: purely structural config with a single outcome | ➖ None needed (config-only change) |

### Remediation Test Summary

- **New/changed tests**: 11 (8 in `tenant-context.test.ts`, 4 added + 1 replaced in `repositories.test.ts`)
- **Total tests passing**: 51 API + 3 domain = 54 across the monorepo's test command surface covered here
- **Approval tests (refactoring)**: None
- **Pure functions created**: 1 (`assertTenantIdMatchesContext`)
- **Negative guard tests added**: 1 script, 2 probes (`contracts/pg`, `domain/drizzle-orm`)

## Verification Results (remediation)

| Command | Result |
|---------|--------|
| `pnpm --filter api test` | ✅ 51 tests passing (was 40) |
| `pnpm --filter api type-check` | ✅ No errors |
| `pnpm deps-guard` | ✅ All clean |
| `pnpm architecture` | ✅ 592 modules cruised, 1588 dependencies; negative guard rejects both contracts and domain DB probes |
| `pnpm build` | ✅ All workspaces build |
| `node scripts/architecture-negative-test.mjs` | ✅ Both probes rejected |

## Spec Compliance After Remediation

| Requirement | Scenario | Before | After |
|-------------|----------|--------|-------|
| Tenant Query Contract | Query with tenant context proceeds | ⚠️ PARTIAL / UNPROVEN — `findTenantById` did not scope to `ctx.tenantId` | ✅ COMPLIANT — mismatch throws before persistence; predicate uses `ctx.tenantId` |
| Persistence Dependency Boundaries | Domain and contracts reject database packages | ❌ FAILING — contracts `pg` import accepted by `pnpm architecture` | ✅ COMPLIANT — `contracts-no-outer-npm-unresolvable` rejects it; negative guard proves regression-protection |
| Assertion Quality (verify) | Repository valid-context assertions prove tenant scoping | ❌ CRITICAL — tested only that persistence was called | ✅ Fixed — mismatch case fails before persistence + matching cases prove scope |

## Deviations from Design (remediation)

- The `architecture` root script now both cruises the dependency graph AND runs a
  focused negative-regression probe (`scripts/architecture-negative-test.mjs`).
  This goes slightly beyond the design's "add dependency-cruiser bans" wording, but
  is the minimum required to make the verify-required negative check durable and
  not dependent on a manual temp-file ritual.

## Remediation Risks

- The contracts negative guard (`contracts-no-outer-npm-unresolvable`) is broad:
  it rejects *any* unresolvable third-party npm import in `packages/contracts/src`,
  not just DB packages. This matches the existing domain rule's breadth. If a
  future legitimate bare third-party type-only dependency is added to contracts,
  the rule would need to be relaxed/extended (e.g. via `pathNot`). No such
  dependency exists today (contracts has only typescript as a devDep).
- The negative guard script spawns `depcruise` as a subprocess. If depcruise's
  CLI output format changes in a future `dependency-cruiser` major version, the
  text-matching assertion would need adjustment; the script pins its scope to the
  inner-layer directories only to keep it fast and deterministic.