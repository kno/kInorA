## Exploration: 01c-v1-multi-tenant-schema

### Current State
The repository has completed the executable foundation slices (`01a` and `01b`): a pnpm monorepo with `apps/web`, `apps/api`, `packages/contracts`, and `packages/domain`. The API currently exposes only a Fastify health route and a lightweight plan boundary validator. The domain package contains a small framework-free `createPlanDraft` use case, and shared DTO-style types live in `packages/contracts`.

There is no database layer yet: no Drizzle schema, migrations, PostgreSQL driver dependency, repository interfaces, tenant model, user model, auth integration, or provisioning flow exists in application code. The roadmap spec at `openspec/specs/01c-v1-multi-tenant-schema/spec.md` is therefore a canonical capability target, not an implemented baseline. Current dependency guards intentionally reject database/auth packages until the relevant slice introduces them.

### Affected Areas
- `openspec/specs/01c-v1-multi-tenant-schema/spec.md` — canonical requirements for tenant-scoped data, tenant provisioning, and explicit tenant query contracts.
- `apps/api/package.json` — will need Drizzle/PostgreSQL/runtime and migration tooling dependencies for the first persistence slice.
- `apps/api/src/db/` — expected new location for Drizzle schema, database client, and migrations; it does not exist yet.
- `apps/api/src/*` — API composition will need persistence wiring and future auth/session context integration while preserving Fastify boundary validation patterns.
- `packages/contracts/src/index.ts` — may need cross-boundary identifiers or DTO contracts, but must not become a database schema dumping ground.
- `packages/domain/src/` — should receive framework-free tenant value objects/repository ports only if domain use cases need tenant context; it must not import Drizzle, Fastify, Auth.js, or PostgreSQL.
- `.dependency-cruiser.cjs` — must continue enforcing inward dependencies; database dependencies should remain blocked from domain.
- `scripts/deps-guard.mjs` — currently prohibits `pg` and `drizzle`; this guard must be updated or scoped when the database slice legitimately adds those dependencies.
- `openspec/specs/05a-v1-auth-core/spec.md` and `openspec/specs/05b-v1-security-tenant-validation/spec.md` — downstream specs depend on tenant association/session context and tenant isolation semantics introduced here.

### Approaches
1. **Database-first tenant foundation** — introduce Drizzle/PostgreSQL schema, migrations, and repository contracts for tenant, user, and membership/association primitives now.
   - Pros: Directly satisfies the 01c canonical target; gives auth and security slices a real tenant substrate; avoids retrofitting tenant IDs after user-owned tables appear.
   - Cons: Requires adding persistence infrastructure earlier than current code has; the dependency guard must be deliberately revised; some auth-related provisioning behavior can only be fully integrated in `05a`.
   - Effort: Medium

2. **Contract-only tenant context** — define tenant identifiers, context types, and repository port interfaces without adding Drizzle migrations yet.
   - Pros: Smaller change and preserves the current no-database baseline; reinforces Clean Architecture boundaries early.
   - Cons: Does not satisfy “first migration” requirements; delays the main tenant isolation risk; leaves auth/security slices without a real persistence target.
   - Effort: Low

3. **Auth-coupled tenant provisioning** — defer tenant schema until Auth.js is introduced and implement tenant creation together with sign-up.
   - Pros: Provisioning can be implemented end-to-end with real registration/session flows.
   - Cons: Violates the roadmap order and makes tenant scope dependent on auth implementation; increases risk of unscoped early persistence decisions.
   - Effort: High

### Recommendation
Use the **Database-first tenant foundation** approach, but keep the slice intentionally narrow: create the persistence foundation and minimal tenant/user association schema now, define explicit tenant-aware repository contracts/tests, and document that full sign-up provisioning integration will be completed by `05a-v1-auth-core`. This best matches the roadmap principle “multi-tenant from the first model/migration” while preserving Clean Architecture: Drizzle and PostgreSQL stay in API/infrastructure code, while domain/contracts expose only stable IDs, context, and ports where needed.

The proposal should explicitly include the dependency-guard update as part of the change, not as incidental cleanup. It should also clarify whether `users` belong to exactly one tenant for v1 or whether the schema starts with a membership table to prepare for trainer/B2B multi-tenant access. Given future Trainer/B2B requirements, a membership/association table is safer than embedding a single `tenantId` only on the user.

### Risks
- The current dependency guard blocks `pg` and `drizzle`; implementation will fail build checks unless the guard is scoped to allow persistence dependencies in `apps/api` for this slice while still blocking them from domain.
- Tenant provisioning is specified for sign-up, but auth does not exist yet; 01c must either implement only a lower-level provisioning service or leave an explicit handoff requirement for `05a`.
- A single-tenant user shortcut could make future Trainer/B2B account access harder; membership modeling should be decided before writing the first migration.
- Repository contracts must require tenant context by type/API design, otherwise tests may pass while future queries can still accidentally omit tenant filters.
- Without row-level security or consistent query helpers, tenant filtering can become a convention instead of an enforceable default.

### Ready for Proposal
Yes — tell the user that exploration found no existing persistence implementation, so the proposal should start 01c as a narrow database-foundation change: add tenant-aware schema/migrations, repository contracts/tests, and update dependency guards deliberately, with auth sign-up integration handed off to `05a`.
