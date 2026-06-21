# Design: 01c V1 Multi-Tenant Schema

## Technical Approach

Introduce the first persistence slice inside API infrastructure only: Drizzle schema, migrations, and tenant repositories live under `apps/api`, while `packages/domain` and `packages/contracts` expose only stable IDs/context types. This implements the delta spec without Auth.js sign-up/session flows, which remain delegated to `05a-v1-auth-core`.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Persistence location | Place Drizzle schema/client in `apps/api/src/db/` plus `apps/api/drizzle/` output | Shared infra package now | No infra package exists; API infrastructure avoids schema leakage. |
| User tenancy | Model `tenants`, `users`, and `memberships` with `memberships(tenantId,userId,role,status)` | Required `users.tenantId` only | Membership avoids the single-tenant shortcut and supports future Trainer/B2B access. |
| Provisioning | Add a lower-level tenant provisioning service/primitive that creates tenant, user, and membership transactionally | Full Auth.js registration | 01c supplies persistence primitives; `05a` owns Auth.js flow and session semantics. |
| Tenant query contract | Require `TenantQueryContext` in tenant-owned repository methods and validate before Drizzle | Optional tenant parameter or route-global convention | Tests prove missing context fails before persistence and prevents unscoped queries. |
| Dependency guards | Scope DB package allow-list to `apps/api` and enforce DB import bans for domain/contracts | Remove DB guard globally | Database dependencies are now in-scope only for API infrastructure; inner layers must stay framework-free. |

## Data Flow

Tenant provisioning primitive:

    Future Auth.js flow (05a) ──→ ProvisionTenantForUser
          │                         │ validate input
          │                         └──→ Drizzle transaction
          │                               ├── users
          │                               ├── tenants
          │                               └── memberships
          └── receives stable tenant/user/member IDs

Tenant-owned query:

    Route/use case ──→ Repository method(ctx, input)
                         │
                         ├── missing ctx.tenantId → throw before DB
                         └── valid ctx.tenantId → Drizzle where tenant_id = ctx.tenantId

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/package.json` | Modify | Add `drizzle-orm`, `pg`, `drizzle-kit`, and DB scripts. |
| `apps/api/drizzle.config.ts` | Create | Drizzle Kit config pointing to API schema and migrations. |
| `apps/api/src/db/schema.ts` | Create | Define `tenants`, `users`, `memberships`; use UUIDs, timestamps, unique `(tenantId,userId)`, and tenant indexes. |
| `apps/api/drizzle/` | Create | Generated SQL migrations for the first tenant foundation. |
| `apps/api/src/db/client.ts` | Create | PostgreSQL pool and Drizzle client factory behind API infrastructure. |
| `apps/api/src/tenant/tenant-context.ts` | Create | Tenant context validation helper used by repositories before persistence. |
| `apps/api/src/tenant/provisioning.ts` | Create | Lower-level transactional tenant/user/membership provisioning primitive. |
| `apps/api/src/tenant/repositories.ts` | Create | Tenant-aware repository implementations that require context. |
| `apps/api/src/tenant/__tests__/*.test.ts` | Create | RED-first tests for schema shape, provisioning, and missing context failure. |
| `packages/contracts/src/index.ts` | Modify | Export branded/string ID and context DTO types only if shared across app boundaries; no Drizzle imports. |
| `packages/domain/src/index.ts` | Modify | Export framework-free tenant context or ports only if domain use cases need them; no persistence implementation. |
| `.dependency-cruiser.cjs` | Modify | Add contracts DB-package bans and, if API is cruised, allow DB imports only from `apps/api/src/db`/tenant infrastructure. |
| `package.json` | Modify | Extend `architecture` target to include API if API-level import rules are added. |
| `scripts/deps-guard.mjs` | Modify | Replace global DB prohibition with API persistence allowance while retaining auth/payment/AI bans. |

## Interfaces / Contracts

`TenantQueryContext` is the repository contract: `{ tenantId: TenantId; actorUserId?: UserId }`. Tenant-owned repository methods accept it first and call a shared assertion before Drizzle. Provisioning exposes `provisionTenantForUser(input)` returning stable `tenantId`, `userId`, and `membershipId`; `05a-v1-auth-core` calls it later from Auth.js work.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `TenantQueryContext` assertion and repository missing-context behavior | Write failing Vitest tests first; use fake DB adapter/spies to prove persistence is not called. |
| Integration | Drizzle schema/migration shape and provisioning transaction | Add API integration tests around schema metadata or test DB once harness exists. |
| Architecture | DB dependency boundaries | Add dependency-cruiser/deps-guard fixtures or direct tests for allowed API DB deps and rejected domain/contracts DB deps. |

Verification commands: `pnpm --filter api test`, `pnpm --filter api type-check`, `pnpm deps-guard`, `pnpm architecture`, and `pnpm build`.

## Migration / Rollout

First migration is additive only. Rollback removes the migration, Drizzle dependencies/config, provisioning/repository code, and guard allow-list. Risks: wrong `DATABASE_URL`, partial migration, missing provisioning transaction, and later auth assuming one active tenant. Mitigate with env validation, migration review, transactional provisioning, and explicit `05a` handoff docs.

## Open Questions

- [ ] Confirm v1 membership role/status enum values.
- [ ] Confirm local PostgreSQL test harness now or in task planning.
