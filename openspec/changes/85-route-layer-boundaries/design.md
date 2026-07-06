# Design: Enforce Clean Architecture Route-Layer Boundaries

## Technical Approach

Apply the `workout-session.ts` reference pattern to `plan.ts`, `admin-ai-config.ts`, and `ws.ts`: declare a named port interface inline, receive it via `Routes Options { repo }`, and remove every `../db/` import. `app.ts` stays the sole composition root — it constructs concrete repos from `database` and injects a port object (a plain object literal satisfying the interface structurally, no `implements`). The one non-trivial concern, `plan.ts`'s cross-repo `db.transaction`, is hidden behind a single port method `promoteDraftToSpec`. PR1 refactors routes + tests (CI green); PR2 adds the dependency-cruiser guard that can only land because PR1 removed all violations.

## Architecture Decisions

### Decision: Where the `db.transaction` wrapper lives

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Object literal adapter inline in `app.ts` | Keeps composition root complete; `db.transaction` closure sits next to repo construction; matches the `configRepo`/`repo` literal style already in `app.ts` | **CHOSEN** |
| Named factory `createPlanRouteRepo(database)` in a new file | Reusable/testable in isolation, but adds a file and indirection the reference pattern (`workout-session.ts`) does not use | Rejected — the pattern injects literals directly; a new file breaks the "inline, no `ports/` dir" convention |

The route calls `repo.promoteDraftToSpec(...)` and no longer references `tx` or `db`. The adapter literal in `app.ts` owns the `database.transaction(async (tx) => { specRepo.create(..., tx); draftRepo.delete(..., tx); })` closure. Atomicity moves from route to composition root — the exact place infrastructure belongs.

### Decision: Auth-plugin `db` is out of scope

`app.ts` still passes `database` to `authPlugin` and `AuthService`; the `routes-no-db-layer` rule targets `^apps/api/src/routes/` only, so plugin wiring is unaffected. `ws.ts` currently constructs `SessionRepository`/`MembershipRepository` from `db`; those move to injected port methods. The auth plugin's own `onRequest` Bearer hook is a separate concern and keeps its `database`.

## Data Flow

    app.ts (composition root)
      new PlanDraftRepository(db) ┐
      new PlanSpecRepository(db)  ├─→ { promoteDraftToSpec, findCurrentDraft, upsertDraft, ... }  ─→ register(planRoutes, { repo })
      db.transaction closure      ┘                                                                        │
                                                                                          plan.ts route → repo.promoteDraftToSpec(...)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/routes/plan.ts` | Modify | Drop `Database` + 3 repo imports; add inline `PlanRouteRepo`; `PlanRoutesOptions { repo; generationService }`; replace `db.transaction` block with `repo.promoteDraftToSpec(...)` |
| `apps/api/src/routes/admin-ai-config.ts` | Modify | Drop `Database`/`UserRepository`/`AiProviderConfigRepository` imports; add inline `AdminAiConfigRouteRepo`; `Options { repo }` |
| `apps/api/src/routes/ws.ts` | Modify | Drop `Database`/`SessionRepository`/`MembershipRepository` imports; add inline `WsRouteRepo`; `WsRoutesOptions { registry; repo; allowedOrigins? }` |
| `apps/api/src/app.ts` | Modify | Build port literals (incl. transaction closure) from `database`; inject into three routes |
| `apps/api/src/routes/__tests__/plan.test.ts` | Modify | Replace promote-path `db.transaction` mock with a `PlanRouteRepo` mock; atomicity asserts on `repo.promoteDraftToSpec` |
| `apps/api/src/routes/__tests__/admin-ai-config.test.ts` | Modify | Inject `AdminAiConfigRouteRepo` mock |
| `apps/api/src/routes/__tests__/ws.test.ts` | Modify | Inject `WsRouteRepo` mock; CSWSH gate asserts port method not called |
| `.dependency-cruiser.cjs` | Modify (PR2) | Add `routes-no-db-layer` forbidden rule |

## Interfaces / Contracts

```typescript
// plan.ts — encapsulates the cross-repo atomic promote + wizard/plan reads
export interface PlanRouteRepo {
  upsertDraft(tenantId: string, userId: string, step: number, spec: Partial<PlanSpec>):
    Promise<{ step: number; specJson: unknown }>;
  findCurrentDraft(tenantId: string, userId: string):
    Promise<{ step: number; specJson: unknown } | null>;
  // Atomic: insert confirmed spec + delete draft in ONE db.transaction (owned by app.ts).
  promoteDraftToSpec(tenantId: string, userId: string, spec: PlanSpec):
    Promise<{ id: string; spec: PlanSpec }>;
  findPlanById(tenantId: string, userId: string, id: string): Promise<WorkoutPlanRecord | undefined>;
  findLatestPlanBySpec(tenantId: string, userId: string, specId: string): Promise<WorkoutPlanRecord | undefined>;
  findAllPlansByUser(tenantId: string, userId: string): Promise<PlanSummary[]>;
}
export interface PlanRoutesOptions {
  repo: PlanRouteRepo;
  generationService: Pick<PlanGenerationService, "startGeneration">;
}

// admin-ai-config.ts — exposes what buildRequireAdmin needs (findById) + config ops
export interface AdminAiConfigRouteRepo {
  findUserById(id: string): Promise<{ id: string; isAdmin: boolean } | null>; // feeds buildRequireAdmin
  getActiveConfig(): Promise<{ provider: string; model: string; updatedAt: Date } | null>;
  upsertConfig(provider: string, model: string): Promise<{ provider: string; model: string; updatedAt: Date }>;
}
export interface AdminAiConfigRoutesOptions { repo: AdminAiConfigRouteRepo; }

// ws.ts — the two Pick-methods already used by wsAuthPreValidation
export interface WsRouteRepo {
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findByTenantAndUser(tenantId: string, userId: string): Promise<MembershipRecord | null>;
}
export interface WsRoutesOptions { registry: WsRegistry; repo: WsRouteRepo; allowedOrigins?: readonly string[]; }
```

`app.ts` composition example:
```typescript
const draftRepo = new PlanDraftRepository(database);
const planRepo: PlanRouteRepo = {
  upsertDraft: (t,u,s,spec) => draftRepo.upsert(t,u,s,spec).then(d => ({ step: d.step, specJson: d.specJson })),
  findCurrentDraft: (t,u) => draftRepo.findCurrent(t,u),
  promoteDraftToSpec: (t,u,spec) => database.transaction(async (tx) => {
    const r = await planSpecRepo.create(t,u,spec,tx); await draftRepo.delete(t,u,tx); return r;
  }),
  findPlanById: (t,u,id) => workoutPlanRepo.findById(t,u,id),
  findLatestPlanBySpec: (t,u,id) => workoutPlanRepo.findLatestByPlanSpec(t,u,id),
  findAllPlansByUser: (t,u) => workoutPlanRepo.findAllByUser(t,u),
};
```

`buildRequireAdmin` accepts `AdminCheckUserRepo { findById }`; adapt via `{ findById: repo.findUserById }` in the route so the existing guard is unchanged.

## Atomicity Approach

`promoteDraftToSpec` is the ONLY place the two writes are observable together. The `app.ts` adapter wraps `specRepo.create(...,tx)` + `draftRepo.delete(...,tx)` in `database.transaction`. The route no longer imports `Database` or references `tx`. The transaction guarantee is asserted by a unit test on the adapter behavior via a port spy (route level) plus preserved integration coverage.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (route) | plan promote path | Inject `PlanRouteRepo` mock; assert `repo.promoteDraftToSpec` called once with `(TENANT_A, USER_A, <derived spec>)`. The old "atomicity" test that spied `db.transaction`/`txInsert`/`txDelete` is replaced by asserting the single port call carries authContext tenant/user (never body values) |
| Unit (route) | admin gate | Inject `AdminAiConfigRouteRepo`; `findUserById` returns `{isAdmin:false}` → 403; config ops via `getActiveConfig`/`upsertConfig` |
| Unit (route) | ws CSWSH gate | Inject `WsRouteRepo` mock with `vi.fn()` spies; evil-Origin request asserts `expect(repo.findByTokenHash).not.toHaveBeenCalled()` (replaces the `db.select` spy) — proving auth never ran. Bearer/cookie/token success + suspended/missing membership still exercised via the port mock. Auth-plugin session lookup keeps its own `db` mock (separate from the route port) |
| Integration | promote atomicity end-to-end | Existing DB-backed E2E (PR3 suite) remains the definitive transaction proof |

Note: `plan.test.ts` currently threads auth through `db.select` (auth plugin) AND route repos through the same `db`. After refactor, auth still uses the `db`-backed `authPlugin`; route data uses the injected `PlanRouteRepo`. The `MEMBERSHIP_SELECT_INDEX` ordering assertions on the auth pipeline stay; only route-data assertions move to the port.

## Dependency-Cruiser Rule (PR2)

```javascript
{
  name: "routes-no-db-layer",
  comment:
    "Route modules MUST NOT import the DB layer directly. Depend on an injected port (see workout-session.ts); app.ts is the sole composition root that constructs repositories.",
  severity: "error",
  from: { path: "^apps/api/src/routes/" },
  to: { path: "^apps/api/src/db/" },
}
```

Test files live under `apps/api/src/routes/__tests__/`, which the `from.path` regex `^apps/api/src/routes/` DOES match. However, after PR1 the tests import ports/mocks and `../../db/client.js` only for the `type Database` used by the auth-plugin session mock — a type-only import. With `tsPreCompilationDeps: true`, dep-cruiser sees type-only imports. To avoid a false positive we scope tests out:

```javascript
  from: { path: "^apps/api/src/routes/", pathNot: "^apps/api/src/routes/__tests__/" },
```

Tests are not production route modules; the boundary we enforce is production code. This mirrors the existing `api-no-db-outside-infra` rule's use of `pathNot`.

## Migration / Rollout

No data migration. PR1: three route refactors + `app.ts` + test reshaping, CI green. PR2: additive dep-cruiser rule only. Rollback = revert commits; `app.ts` already held the repo constructors as `db` pass-throughs.

## Open Questions

- [ ] Confirm during apply whether `plan.test.ts` still needs `type Database` after removing the promote `db.transaction` mock — if the auth mock is fully self-contained the `pathNot` test carve-out may be unnecessary, but keep it for safety.
