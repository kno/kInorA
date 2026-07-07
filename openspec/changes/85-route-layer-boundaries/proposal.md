# Proposal: Enforce Clean Architecture Route-Layer Boundaries

## Intent

Route modules in `apps/api/src/routes/` directly construct and use database-layer objects (`Database`, concrete repositories), bypassing the dependency-inversion rule already established and exemplified by `workout-session.ts`. This makes routes untestable without a real database connection, conflates infrastructure with routing concern, and leaves the architecture guard blind to these local violations (`.dependency-cruiser.cjs` only checks npm package imports, not relative `../db/` paths). Fixing this aligns three route modules with the existing pattern and adds a mechanical guard so the boundary cannot regress.

## Scope

### In Scope
- Refactor `apps/api/src/routes/plan.ts` — extract inline `Database`/repo construction; expose a named port `PlanRouteRepo` with a `promoteDraftToSpec(draftId, specPayload)` method that encapsulates the cross-repo transaction; inject via `PlanRoutesOptions { repo }`
- Refactor `apps/api/src/routes/admin-ai-config.ts` — extract inline `Database`/repo construction; expose `AdminAiConfigRouteRepo`; inject via options
- Refactor `apps/api/src/routes/ws.ts` — extract inline `Database`/repo construction; expose `WsRouteRepo`; inject via options
- Update `apps/api/src/app.ts` — construct concrete repos + transaction wrapper in composition root; inject ports into the three refactored routes
- Reshape tests `plan.test.ts`, `admin-ai-config.test.ts`, `ws.test.ts` — replace `db` mock with port-mock; preserve atomicity test and CSWSH gate test semantics
- **PR2 (after PR1 green):** add `routes-no-db-layer` rule to `.dependency-cruiser.cjs` — `from: ^apps/api/src/routes/` must not reach `to: ^apps/api/src/db/`

### Out of Scope
- Moving port interfaces to a dedicated `ports/` directory (inline convention, matching `workout-session.ts`)
- Refactoring `apps/api/src/ai/port.ts` or any non-route layer
- Modifying the domain or contracts packages
- Adding coverage thresholds or linter configuration

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `01b-v1-clean-architecture-contracts`: the "Layer violation fails" scenario now explicitly covers local relative `../db/` imports from route modules, not only npm package imports

## Approach

Follow the `workout-session.ts` reference pattern for all three routes:

1. Declare a named port interface inline in each route module (e.g., `PlanRouteRepo`)
2. For `plan.ts`, the key design challenge is the cross-repo transaction (`db.transaction` spanning `specRepo.create` + `draftRepo.delete`). The port method `promoteDraftToSpec` hides this atomicity concern — the concrete implementation in `app.ts` wraps both repo calls in a `db.transaction`; the route sees only a single port call
3. `app.ts` becomes the sole composition root: `new PlanRepository(database)`, `new PlanDraftRepository(database)`, wrapped into a port object literal, passed via `app.register(planRoutes, { repo })`
4. PR1 delivers the three route refactors + test reshaping; CI must be green
5. PR2 adds the dependency-cruiser rule; it can only land cleanly because PR1 already eliminated all violations

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/routes/plan.ts` | Modified | Remove `../db/` imports; add inline port; receive injection |
| `apps/api/src/routes/admin-ai-config.ts` | Modified | Remove `../db/` imports; add inline port; receive injection |
| `apps/api/src/routes/ws.ts` | Modified | Remove `../db/` imports; add inline port; receive injection |
| `apps/api/src/app.ts` | Modified | Construct repos + port adapters; inject into three routes |
| `apps/api/src/routes/plan.test.ts` | Modified | Replace `db` mock with `PlanRouteRepo` port mock |
| `apps/api/src/routes/admin-ai-config.test.ts` | Modified | Replace `db` mock with port mock |
| `apps/api/src/routes/ws.test.ts` | Modified | Replace `db` mock + CSWSH gate spy with port mock |
| `.dependency-cruiser.cjs` | Modified | Add `routes-no-db-layer` rule (PR2) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Transaction atomicity lost in `plan.ts` refactor | Med | Port method `promoteDraftToSpec` wraps both repo ops in one `db.transaction` inside `app.ts`; existing atomicity test validates this |
| Test reshaping breaks plan atomicity coverage | Med | Keep the existing test scenario; only replace the `db.transaction` spy with a port-method spy/mock |
| PR2 dependency-cruiser rule blocks other future PRs if any new route import slips through | Low | Rule is additive and targeted; new violations will surface in CI immediately — that is the desired outcome |
| Port interface naming diverges from workout-session.ts convention | Low | Spec phase defines the naming contract; design phase enforces it |

## Rollback Plan

- **PR1**: revert the three route module commits + `app.ts` changes; the repository constructors were already in `app.ts` as raw `db` pass-throughs, so rolling back restores that state
- **PR2**: remove the `routes-no-db-layer` rule from `.dependency-cruiser.cjs`; no behavioral code is affected

## Dependencies

- `workout-session.ts` reference pattern already merged (confirmed in codebase)
- PR2 depends on PR1 CI passing; must not be raised simultaneously

## Success Criteria

- [ ] `apps/api/src/routes/plan.ts`, `admin-ai-config.ts`, `ws.ts` contain zero imports matching `../db/`
- [ ] `apps/api/src/app.ts` is the sole file constructing concrete repository instances from `database`
- [ ] All existing API route tests pass without a real `Database` object (port mocks only)
- [ ] `pnpm architecture` passes with `routes-no-db-layer` rule active (PR2)
- [ ] The plan atomicity scenario (promote draft → spec) continues to be covered by a test
