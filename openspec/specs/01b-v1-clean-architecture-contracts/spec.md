# 01b-v1-clean-architecture-contracts Specification

## Purpose

Define Clean Architecture boundaries and shared contracts before feature code exists.

## Dependencies

- `01a-v1-monorepo-setup`

## Requirements

### Requirement: Layered Dependency Direction

The system SHOULD enforce dependency direction from outer layers toward inner layers: infrastructure/adapters MAY depend on use cases and domain, but domain MUST NOT depend on infrastructure. Route modules MUST NOT import from the database layer directly; all route-to-database coupling MUST be mediated through named port interfaces.

#### Scenario: Layer violation fails — npm package import

- GIVEN a domain file imports from an infrastructure npm package
- WHEN lint or build runs
- THEN the check MUST fail with a layer-boundary error

#### Scenario: Layer violation fails — route imports ../db/ directly

- GIVEN a route module under `apps/api/src/routes/` contains a relative import resolving to `apps/api/src/db/`
- WHEN `pnpm architecture` runs with the `routes-no-db-layer` dependency-cruiser rule active
- THEN the check MUST fail with a `routes-no-db-layer` boundary error

### Requirement: Shared Contracts

Shared data contracts MUST live in shared packages and MUST be usable by web, API, and mobile shell integrations.

#### Scenario: Contract reused by API and web

- GIVEN a `PlanSpec` contract is exported
- WHEN web submits a plan wizard payload and API validates it
- THEN both sides use the same contract shape

### Requirement: Domain Isolation

Domain entities and use cases MUST be testable without network, database, framework, or UI dependencies.

#### Scenario: Domain test runs in isolation

- GIVEN a use case test imports only domain and contract packages
- WHEN the unit test runs
- THEN no framework or database module is loaded

### Requirement: Route Module Port Naming Contract

Each route module MUST declare an inline named port interface following the convention `XxxRouteRepo` and accept injection through a corresponding `XxxRoutesOptions { repo: XxxRouteRepo }` object. The three contracted names are `PlanRouteRepo`, `AdminAiConfigRouteRepo`, and `WsRouteRepo`.

#### Scenario: Port interface declared inline in route module

- GIVEN a route module file under `apps/api/src/routes/`
- WHEN the file is read
- THEN it MUST export or declare a named interface matching `XxxRouteRepo`
- AND it MUST accept an options parameter typed as `XxxRoutesOptions { repo: XxxRouteRepo }`

#### Scenario: Port naming drift rejected

- GIVEN an apply artifact uses a non-canonical name (e.g. `PlanRepo`, `IRouteRepo`)
- WHEN the spec is reviewed
- THEN the name MUST be rejected as non-conforming to the `XxxRouteRepo` convention

### Requirement: Route Modules Contain Zero Direct DB Imports

Route modules under `apps/api/src/routes/` MUST NOT contain any import that resolves to `apps/api/src/db/` (relative `../db/` paths or equivalent). All database access MUST be mediated through the declared port interface.

#### Scenario: Route module has no ../db/ import

- GIVEN `plan.ts`, `admin-ai-config.ts`, or `ws.ts` is loaded
- WHEN all import statements are inspected
- THEN zero imports matching `../db/` MUST exist in each file

#### Scenario: Future route added with direct db import

- GIVEN a developer adds a new route under `apps/api/src/routes/` that imports `../db/`
- WHEN `pnpm architecture` runs
- THEN the `routes-no-db-layer` dependency-cruiser rule MUST fail the build

### Requirement: app.ts as Sole Composition Root

`apps/api/src/app.ts` MUST be the only file that constructs concrete repository instances from the `database` object. No other file MAY instantiate a concrete repository or pass `database` directly into a route.

#### Scenario: Composition root constructs and injects all repos

- GIVEN `app.ts` bootstraps the Fastify application
- WHEN it registers the three route modules
- THEN it MUST construct concrete repo adapters and pass them as `{ repo }` to each route

#### Scenario: No other file constructs concrete repos

- GIVEN any file outside `app.ts` is inspected
- WHEN imports and constructors are reviewed
- THEN no `new PlanRepository(database)` or equivalent repo construction MAY appear outside `app.ts`

### Requirement: Plan Draft-to-Spec Promotion Atomicity via Port

The `PlanRouteRepo` port MUST expose a single method `promoteDraftToSpec(draftId, specPayload)` that encapsulates the cross-repository transaction. The route MUST call only this method; transaction management MUST NOT be visible to the route layer.

#### Scenario: Promotion executes atomically through port

- GIVEN the plan route receives a promote-draft request
- WHEN the route calls `repo.promoteDraftToSpec(draftId, specPayload)`
- THEN both the spec creation and draft deletion MUST succeed or both MUST roll back
- AND the route MUST NOT reference any transaction primitive directly

#### Scenario: Promotion atomicity covered without real database

- GIVEN a `PlanRouteRepo` port mock is configured to spy on `promoteDraftToSpec`
- WHEN the plan route test triggers a promotion
- THEN the test MUST verify `promoteDraftToSpec` was called once with the correct arguments
- AND no real `Database` object MUST be required

### Requirement: Route Tests Use Port Mocks Only

Tests for `plan.ts`, `admin-ai-config.ts`, and `ws.ts` MUST run using port mocks that satisfy the respective `XxxRouteRepo` interface. No test in these files MAY require a real `Database` connection.

#### Scenario: Plan route tests pass with port mock

- GIVEN a test file for `plan.ts` imports a mock implementing `PlanRouteRepo`
- WHEN all tests in the file run
- THEN they MUST pass with no real database connection

#### Scenario: WS route CSWSH auth-gate covered via port mock

- GIVEN the WS route test provides a `WsRouteRepo` mock
- WHEN an unauthenticated WebSocket upgrade is attempted
- THEN the auth-gate scenario MUST reject the connection
- AND the test MUST not depend on a real database

### Requirement: routes-no-db-layer Cruiser Rule Active

The `.dependency-cruiser.cjs` configuration MUST include a `routes-no-db-layer` rule that forbids any module matching `^apps/api/src/routes/` from importing any module matching `^apps/api/src/db/`. This rule MUST be enforced during the `pnpm architecture` check in CI (PR2, after PR1 is green).

#### Scenario: Cruiser rule blocks route-to-db import

- GIVEN `.dependency-cruiser.cjs` contains the `routes-no-db-layer` rule
- WHEN a route module imports `../db/database`
- THEN `pnpm architecture` MUST exit non-zero with a `routes-no-db-layer` violation

#### Scenario: Clean codebase passes architecture check

- GIVEN all three route modules have been refactored to use port injection
- WHEN `pnpm architecture` runs with the `routes-no-db-layer` rule active
- THEN the command MUST exit zero with no violations
