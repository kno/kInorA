# Proposal: 01c V1 Multi-Tenant Schema

## Intent

Establish the roadmap `01c` tenant foundation before user-owned persistence grows. The change keeps multi-tenancy explicit from the first migration while preserving Clean Architecture boundaries for downstream auth and security slices.

## Scope

### In Scope
- Tenant-aware Drizzle/PostgreSQL schema and first migrations in API infrastructure.
- Tenant, user, and membership/association primitives for future Trainer/B2B access.
- Explicit tenant query contracts and tests that reject tenant-owned repository calls without tenant context.
- Dependency guard updates that allow database dependencies only where architecture permits.
- Optional lower-level tenant provisioning primitives usable later by auth.

### Out of Scope
- Full Auth.js sign-up/session integration; hand off to `05a-v1-auth-core`.
- UI flows, billing, invitations, organization management, or RLS policy rollout.
- Database imports from `packages/domain` or schema leakage into `packages/contracts`.
- Application implementation changes during this proposal phase.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `01c-v1-multi-tenant-schema`: narrow the canonical capability into a database-first tenant foundation with explicit auth handoff.

## Approach

Follow exploration’s database-first recommendation: add persistence infrastructure in `apps/api`, keep Drizzle/PostgreSQL behind infrastructure adapters, expose only stable IDs/context/ports through domain/contracts when needed, and make tenant context mandatory by contract and tests. Model user-to-tenant association via membership rather than a single-user shortcut.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/` | New | Drizzle schema, client boundary, migrations. |
| `apps/api/package.json` | Modified | Add scoped persistence/migration dependencies. |
| `packages/domain/src/` | Modified | Stable tenant IDs/context/ports only if needed. |
| `packages/contracts/src/index.ts` | Modified | Cross-boundary IDs/DTOs only; no DB schema. |
| `.dependency-cruiser.cjs` | Modified | Keep DB dependencies out of domain/contracts. |
| `scripts/deps-guard.mjs` | Modified | Allow DB packages deliberately for API infrastructure. |
| `openspec/specs/05a-v1-auth-core/spec.md` | Dependency | Receives sign-up provisioning handoff. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Auth provisioning ambiguity | Med | Document 01c primitives and `05a` integration boundary. |
| Tenant filter omitted later | Med | Require tenant context in repository contracts/tests. |
| Architecture leakage | Med | Enforce dependency guards and ports-only domain boundary. |

## Rollback Plan

Revert the 01c change set: remove API persistence dependencies, Drizzle schema/migrations, tenant repository contracts/tests, and guard exceptions. Since this slice defines the first persistence foundation, rollback should leave no production data migration dependency.

## Dependencies

- Completed `01a-v1-monorepo-setup` and `01b-v1-clean-architecture-contracts`.
- PostgreSQL/Drizzle decisions remain API-infrastructure scoped.
- Auth sign-up completion depends on `05a-v1-auth-core`.

## Success Criteria

- [ ] Tenant/user/membership schema and migrations satisfy the canonical `01c` roadmap spec.
- [ ] Tenant-owned repository contracts/tests fail before persistence when tenant context is absent.
- [ ] Dependency guards permit API persistence while blocking DB dependencies from domain/contracts.
- [ ] Auth.js sign-up integration is explicitly deferred to `05a` with usable lower-level primitives if added.
