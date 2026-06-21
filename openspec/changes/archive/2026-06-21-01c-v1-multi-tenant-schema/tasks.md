# Tasks: 01c V1 Multi-Tenant Schema

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 400–550 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR with size awareness |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full 01c change: deps, schema, context, provisioning, guards | PR 1 | single PR; if >400 lines, maintainer approves size:exception |

## Phase 1: Dependencies & Infrastructure

- [x] 1.1 Add `drizzle-orm`, `pg`, `drizzle-kit` (dev) to `apps/api/package.json`; add `db:generate` and `db:migrate` scripts
- [x] 1.2 Create `apps/api/drizzle.config.ts` pointing to `apps/api/src/db/schema.ts` and migration output `apps/api/drizzle/`
- [x] 1.3 Create `apps/api/src/db/client.ts` with PostgreSQL pool factory and Drizzle client export behind API infrastructure

## Phase 2: Schema & Migration (TDD)

- [x] 2.1 RED: Write failing test for Drizzle schema shape — `tenants`, `users`, `memberships` tables, UUIDs, timestamps, unique `(tenantId,userId)` constraint — in `apps/api/src/tenant/__tests__/schema.test.ts`
- [x] 2.2 GREEN: Create `apps/api/src/db/schema.ts` with `tenants`, `users`, `memberships` table definitions; use UUIDs, timestamps, role/status columns (see open question below), and tenant indexes
- [x] 2.3 Run `pnpm --filter api db:generate` to produce first migration in `apps/api/drizzle/`

## Phase 3: Tenant Context & Contracts (TDD)

- [x] 3.1 RED: Write failing test asserting `TenantQueryContext` rejects calls missing `tenantId` before persistence in `apps/api/src/tenant/__tests__/tenant-context.test.ts`
- [x] 3.2 GREEN: Create `apps/api/src/tenant/tenant-context.ts` with `TenantQueryContext` type and `assertTenantContext()` validation helper
- [x] 3.3 Update `packages/contracts/src/index.ts` — export branded `TenantId`, `UserId`, `MembershipId` types and `TenantQueryContext` DTO (no DB imports)

## Phase 4: Provisioning & Repositories (TDD)

- [x] 4.1 RED: Write failing test for `provisionTenantForUser()` transaction (creates tenant + user + membership) in `apps/api/src/tenant/__tests__/provisioning.test.ts`
- [x] 4.2 GREEN: Create `apps/api/src/tenant/provisioning.ts` with transactional `provisionTenantForUser()` returning stable IDs
- [x] 4.3 RED: Write failing test for repository methods rejecting missing tenant context and succeeding with valid context in `apps/api/src/tenant/__tests__/repositories.test.ts`
- [x] 4.4 GREEN: Create `apps/api/src/tenant/repositories.ts` with tenant-scoped query methods requiring `TenantQueryContext`

## Phase 5: Architecture Guards

- [x] 5.1 Update `scripts/deps-guard.mjs` — replace global `pg`/`drizzle` prohibition with `apps/api` allowance while keeping domain/contracts bans
- [x] 5.2 Update `.dependency-cruiser.cjs` — add contracts DB-package import ban; allow DB from `apps/api/src/(db|tenant)/` only
- [x] 5.3 Update root `package.json` `architecture` script to include `apps/api/src` in dependency-cruiser scope

## Phase 6: Verification

- [x] 6.1 Run `pnpm --filter api test`, `pnpm --filter api type-check`, `pnpm deps-guard`, `pnpm architecture`, `pnpm build` — all must pass
- [x] 6.2 Confirm membership `role`/`status` enum values cover `owner`/`member` and `active`/`invited`/`suspended` (design gate open question); adjust schema if needed
- [x] 6.3 Confirm PostgreSQL test harness strategy for integration tests (design gate open question) — either add Docker Compose service or document manual setup

## Out of Scope (deferred to 05a-v1-auth-core)

- Full Auth.js sign-up and session integration
- User registration flow with password hashing
- Session tenant context middleware for HTTP routes