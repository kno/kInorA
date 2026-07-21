# Apply Progress: E2E Resource Safety

## Status

- Change: `09e-v1-e2e-resource-safety`
- Apply state: partial
- Mode: Strict TDD
- Delivery: one PR with maintainer-approved `size:exception`
- Completed: tasks 1.1-4.8, 5.2-5.5, and 5.4
- Remaining: task 5.1 (legacy all-in-one dev expectation is superseded by the production-only PWA run)

## Implementation

- Preserved and audited the partial worker bounds, scoped V8 heap cap, worker CLI parsing, Docker classifier, and constrained launch.
- Added an exported, dependency-injected teardown lifecycle with `starting`, `running`, `exiting`, and `cleaned` states.
- Tracked the Playwright child and awaitable exit handle immediately, then marked it running only after the child `spawn` event.
- Added signal-aware normal waiting, process-group SIGINT/SIGTERM forwarding, 5-second bounded waits, SIGKILL fallback, startup stop gates, sequential guarded cleanup, idempotency, and exit-code precedence.
- Kept `NODE_OPTIONS` scoped to Playwright webServer children and restored executable mode on `scripts/e2e-with-stack.mjs`.
- Added testable Docker launch and run-start formatting units without dependencies.
- Confirmed eight E2E spec files remain present and made no E2E spec edits.
- Remediated split API-port configuration discovered at runtime: `E2E_API_PORT` now controls the Playwright API health probe and API child `PORT`, while an injected `API_BASE_URL` remains authoritative and port 4000 remains the fallback.
- Added opt-in `E2E_PWA_PRODUCTION=true` mode: the dedicated `pwa-production` project matches only `tests/e2e/pwa.spec.ts`, and its web server runs `pnpm --filter web build && pnpm --filter web start --hostname 127.0.0.1 --port 3000`; the default `chromium` project remains on `next dev`.
- Added `pnpm test:e2e:pwa` as the explicit production-PWA entry point. The production web server inherits the same isolated API port/base URL environment and remains under Playwright teardown.

## Strict TDD Evidence

| Tasks | Test file | Layer | Safety net | RED | GREEN | Triangle / refactor |
|---|---|---|---|---|---|---|
| 1.1-2.4 | `scripts/__tests__/e2e-resource-safety.test.ts` | Unit | Inherited partial: 38 tests passed before lifecycle work | Prior chronology unavailable; retained only after audit | 38/38 inherited tests remained green | Added direct constrained-launch coverage during reconciliation |
| 3.1-3.6 | `scripts/__tests__/e2e-resource-safety.test.ts` | Unit | 38 passed | `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts`: 22 lifecycle failures, `createLifecycle is not a function` | 60/60 passed after lifecycle implementation and deterministic harness correction | Covered normal, SIGINT, SIGTERM, timeout/kill, cleanup failures, startup failure, and concurrent teardown |
| 4.1-4.4 | `scripts/__tests__/e2e-resource-safety.test.ts` | Unit + subprocess | 60/60 passed | 4 failures for absent `startPostgresWith` and `formatRunStartLog`; 64 existing tests passed | 68/68 passed | Invalid memory, one-CPU CI, both valid worker forms, and four invalid CLI subprocess cases covered |
| 4.6-4.7 | `scripts/__tests__/e2e-resource-safety.test.ts` | Config integration | 68/68 passed | `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts`: 3 config failures, 68 existing tests passed; health URL remained on 4000 and API child `PORT` was absent | 71/71 passed after the minimal config change | Three cases cover isolated port derivation, injected `API_BASE_URL` precedence, and default port 4000; no refactor beyond shared derived constants |
| 5.2 | `scripts/__tests__/e2e-resource-safety.test.ts` | Config integration + E2E | 71/71 passed | `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts`: 2 production-mode tests failed because config still selected `next dev` and `chromium` | 75/75 passed; production PWA E2E passed 4/4 | Triangle covers exact `true` activation, isolated API port, injected API URL precedence, and dedicated project selection |
| 5.3 | `scripts/__tests__/e2e-resource-safety.test.ts` | Unit | Included in inherited 38 passing tests | Approval coverage retained for existing partial behavior | `stackEnv()` tests pass without adding or mutating `NODE_OPTIONS` | Existing parent value is preserved verbatim |

The inherited tasks 1.1-2.4 were already checked before this executor began and had no valid prior apply-progress. Their original RED-before-GREEN chronology cannot be reconstructed, so this artifact does not fabricate it.

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test | `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` -> exit 0; 1 file, 75 tests passed |
| Runtime harness | `E2E_API_PORT=4102 pnpm test:e2e:pwa` -> exit 0; production `next build` completed before `next start`, 4 PWA tests passed with 2 workers, Postgres teardown completed. |
| Normal dev harness | `E2E_API_PORT=4103 pnpm test:e2e --workers=2` -> exit 1; 31 tests, 28 passed, 2 pre-existing conditional skips, 1 known PWA service-worker timeout under `next dev`; Postgres teardown completed. |
| Rollback boundary | Revert only `playwright.config.ts`, `package.json`, `scripts/e2e-with-stack.mjs`, `scripts/__tests__/e2e-resource-safety.test.ts`, and this 09e change folder. No 09d or unrelated application files are involved. |

## Commands And Results

| Command | Exact result |
|---|---|
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` (safety net) | PASS: 1 test file, 68 tests passed |
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` (RED) | FAIL as expected: 1 test file; 3 config tests failed, 68 existing tests passed |
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` (GREEN) | PASS: 1 test file, 71 tests passed |
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` (production PWA RED/GREEN/Triangle) | RED: 2 new config tests failed; GREEN/Triangle: 1 test file, 75 tests passed |
| `node --check scripts/e2e-with-stack.mjs` | PASS: exit 0, no output |
| `pnpm type-check` | PASS: 6 workspace projects completed |
| `pnpm test` | PASS: 201 files, 1,949 tests across i18n (27), contracts (43), domain (253), mobile (221), api (644), and web (761) |
| `pnpm architecture` | PASS: 1,562 modules and 4,451 dependencies; both negative probes passed |
| `pnpm deps-guard` | PASS: no prohibited packages |
| `pnpm build` | PASS: dependency, UI/API, architecture, workspace TypeScript, API, and Next.js production builds passed |
| `pnpm test:e2e:pwa` (first attempt) | BLOCKED: Podman machine API was unavailable; no Playwright tests started; Postgres teardown attempted |
| `podman machine start` | PASS: `podman-machine-default` started successfully |
| `E2E_API_PORT=4102 pnpm test:e2e:pwa` | PASS: production build + start; 4 tests passed, 0 skipped, exit 0 |
| `E2E_API_PORT=4103 pnpm test:e2e --workers=2` | EXPECTED LEGACY DEV FAILURE: 28 passed, 2 skipped, 1 PWA service-worker timeout; exit 1 and teardown completed |
| `docker info --format '{{.ServerVersion}}'` | BLOCKED: `docker` command not found |
| `podman info --format '{{.Version.Version}}'` (prior apply) | BLOCKED at that time: Podman 5.8.2 installed, but connection to `127.0.0.1:56132` refused; later orchestrator evidence confirms Podman started and reached Playwright |
| `sysctl -n hw.memsize` | Host memory: 25,769,803,776 bytes (24 GiB) |
| `podman machine start` | PASS: `podman-machine-default` started with 4 CPUs and 4 GiB; rootless API became reachable |
| `E2E_API_PORT=4100 /usr/bin/time -l pnpm test:e2e --workers=2` | RESOURCE-SAFE / SUITE FAIL: 2 workers; 31 tests in 72.40s; 28 passed, 2 skipped, 1 PWA timeout; orchestrator maximum RSS 272,072,704 bytes; Postgres teardown ran |
| `E2E_API_PORT=4101 pnpm test:e2e --workers 2` | PARSING PASS / SUITE FAIL: separated worker form normalized to 2 and safely ran 31 tests; 28 passed, 2 skipped, same PWA timeout; Postgres teardown ran |
| `podman ps -a --filter name=kinora-e2e-pg` | PASS: no E2E Postgres container remained after the failed suite |
| `lsof -nP -iTCP:4100 -sTCP:LISTEN` | PASS: no API listener remained after teardown |

## Resource Observations

- Configured Playwright defaults are local `2` and CI `Math.min(2, os.cpus().length)`.
- Configured webServer V8 old-space cap defaults to 2,048 MB and is overridable through `E2E_NODE_MEMORY`.
- The V8 cap is not reported as an RSS ceiling.
- The bounded full-stack run completed without host collapse. `/usr/bin/time -l` measured 272,072,704 bytes maximum RSS for the orchestrator process; this does not claim aggregate child-process RSS.
- Eight `tests/e2e/**/*.spec.ts` files are present. The normal dev run remains 28 passed, 2 pre-existing conditional skips, and 1 PWA timeout while waiting for `navigator.serviceWorker.ready` under `next dev --turbopack`; the dedicated production PWA run is 4 passed, 0 skipped, exit 0.
- Teardown removed the Postgres container and released isolated API port 4100 after the failed suite.

## Deviations And Remaining Work

- The implementation adds `scripts/__tests__/e2e-resource-safety.test.ts` for the focused regression suite. The design now records this test-only file explicitly; production scope remains limited to the two planned files.
- Task 4.5 is complete: both worker syntaxes reached Playwright through the full orchestrator with the effective log `workers=2`; invalid forms exit 1 in focused subprocess tests.
- Task 4.8 is complete: the isolated-port bounded stack reached and ran Playwright.
- Task 5.1 remains open as a legacy all-in-one dev expectation: `next dev` cannot provide the live Serwist service-worker precondition. Task 5.2 is complete through the dedicated production PWA mode; the normal dev suite's known timeout is intentionally not suppressed.
- Task 5.5 records that default E2E behavior remains on `next dev` with bounded 2-worker execution; production build/start is paid only by `test:e2e:pwa`.
- Task 5.4 is complete with the available orchestrator RSS measurement; aggregate child-process RSS was not captured and is not claimed.
- No `*.memory.md` files existed inside the 09e root, so none were removed.

## Startup Cancellation Remediation Progress — 2026-07-20

The successor review identified that SIGINT/SIGTERM could begin teardown while readiness or startup children continued blocking. This section records the focused remediation without changing the earlier partial-apply chronology.

### Tasks Completed

| Task | Status | Evidence |
|------|--------|----------|
| 6.1 cancellation RED tests | ✅ | Added deterministic pre-readiness abort and running-child abort tests |
| 6.2 signal-aware startup | ✅ | Lifecycle `AbortSignal` now reaches Postgres readiness, migrations, and workspace-library build child work |
| 6.3 triangle | ✅ | Both cancellation paths pass without waiting for the 30-second readiness deadline |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 6.1–6.3 | `scripts/__tests__/e2e-resource-safety.test.ts` | Unit + subprocess | ✅ 75/75 | ✅ 2 missing-export failures before fix | ✅ 77/77 | ✅ readiness and child cancellation | ✅ shared lifecycle abort signal |

### Verification Evidence

| Command | Exact result |
|---------|--------------|
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` | 1 file / 77 tests passed |
| `node --check scripts/e2e-with-stack.mjs` | Exit 0 |

### Files Changed

| File | Action | Evidence |
|------|--------|----------|
| `scripts/e2e-with-stack.mjs` | Modified | Readiness polling and migration/build children observe lifecycle abort; signal exit precedence and cleanup remain unchanged |
| `scripts/__tests__/e2e-resource-safety.test.ts` | Modified | Added deterministic startup cancellation coverage |

## Review Remediation Progress — 2026-07-20 (Current Blocker)

The latest native review identified that production PWA mode could reuse an
existing local server. The web server now disables reuse only when
`E2E_PWA_PRODUCTION=true`; normal development behavior remains unchanged.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 7.1–7.2 PWA reuse mode | `scripts/__tests__/e2e-resource-safety.test.ts` | Config integration | ✅ 77/77 pre-change | ✅ 2 assertions failed: production reuse was `true` | ✅ 78/78 passed | ✅ dev reuse `true`, production reuse `false` | ✅ conditional config expression only |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test | `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` → 1 file / 78 tests passed |
| Runtime harness | N/A — this deterministic config behavior is covered by Vitest import/config integration; no stack startup was required |
| Rollback boundary | Revert only the `reuseExistingServer` expression in `playwright.config.ts`, its focused assertions, and this appended 09e evidence |

### Verification Evidence

| Command | Exact result |
|---|---|
| `pnpm exec vitest run scripts/__tests__/e2e-resource-safety.test.ts` | PASS: 1 file / 78 tests |
| `pnpm type-check` | PASS: all 6 workspace projects |
| `pnpm architecture` | PASS: no dependency violations; negative guard passed |
| `pnpm deps-guard` | PASS: no prohibited packages |
| `pnpm build` | PASS: dependency/UI/API/architecture guards and workspace builds completed |
