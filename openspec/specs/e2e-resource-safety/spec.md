# e2e-resource-safety Specification

## Purpose

Bound E2E test resource consumption (Playwright workers, dev-server memory, container constraints) so the suite runs reliably on 8–16 GB machines without reducing coverage or adding dependencies.

## Requirements

### Requirement: Worker Bounds

The system MUST limit Playwright workers to prevent host resource exhaustion. The local default MUST be `2`; the CI default MUST be `Math.min(2, os.cpus().length)`. An explicit CLI override MUST be accepted in both equals and separated-value forms.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 1 | **Default local workers** | `CI` is unset; E2E starts without an override | Playwright launches | worker count = `2` |
| 2 | **Default CI workers** | `CI` is truthy; `os.cpus().length ≥ 1` | Playwright launches | worker count = `Math.min(2, os.cpus().length)` |
| 3 | **Explicit override** | `--workers=2` passed to `pnpm test:e2e` | Playwright launches | worker count = 2 |
| 4 | **Separated explicit override** | `--workers 2` passed to `pnpm test:e2e` | Playwright launches | worker count = 2 |
| 5 | **Invalid worker values** | `--workers=0`, `--workers=-1`, or a non-numeric value is passed | orchestrator parses args | clear error and non-zero exit code |
| 6 | **Missing value after flag** | `--workers` is last arg with no value | orchestrator parses args | clear error and non-zero exit code |

### Requirement: Web Server Memory Caps

Each webServer process MUST run with scoped `NODE_OPTIONS` capping V8 heap usage. The limit MUST be overridable via env and MUST NOT mutate the global `NODE_OPTIONS`. This cap does not guarantee a process RSS ceiling.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 6 | **Default memory cap** | `E2E_NODE_MEMORY` unset | webServers start | api and web inherit `NODE_OPTIONS=--max-old-space-size=2048` |
| 7 | **Env override** | `E2E_NODE_MEMORY=4096` exported | webServers start | both processes inherit `--max-old-space-size=4096` |
| 8 | **No global mutation** | parent shell has any `NODE_OPTIONS` | E2E run completes | parent `NODE_OPTIONS` is unchanged after run |
| 9 | **RSS distinction** | app memory baseline and native allocations are unknown | memory is evaluated | measured RSS/budget evidence is reported where feasible; the configured V8 heap cap is not presented as an RSS guarantee |

### Requirement: Container Resource Constraints

The Postgres container MUST attempt startup atomically with `--memory=1g --cpus=1`. It MAY fall back exactly once to the unconstrained command only when the constrained command exits with status `125` and stderr matches an unsupported-option signature (`unknown flag`, `unknown option`, `flag provided but not defined`, or `unrecognized option`) together with `--memory` or `--cpus`. Image pull/auth, port conflict, invalid image, daemon unavailable, generic invalid argument, and all other failures MUST propagate without retry. The fallback reason MUST be logged.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 10 | **Runtime supports flags** | constrained startup succeeds | Postgres starts | container gets `--memory=1g --cpus=1` |
| 11 | **Unsupported resource flags** | constrained startup exits `125` and stderr is `unknown flag: --cpus` | fallback starts | full unconstrained command is retried exactly once; fallback reason is logged |
| 12 | **Other unsupported-option wording** | constrained startup exits `125` and stderr is `flag provided but not defined: --memory` | fallback starts | full unconstrained command is retried exactly once |
| 13 | **Wrong status** | stderr contains `unknown flag: --cpus` but exit status is not `125` | startup handles failure | no fallback; original failure propagates |
| 14 | **Wrong stderr** | constrained startup exits `125` with image pull, auth, port, invalid-image, daemon-unavailable, generic-invalid-argument, or unrelated stderr | startup handles failure | no fallback; original failure propagates |

### Requirement: Run-Start Observability

The orchestrator MUST log effective resource bounds before Playwright launches.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 13 | **Default config** | default workers apply | run starts | log prints effective worker count and Node memory cap |
| 14 | **CLI override** | either `--workers=2` or `--workers 2` is passed | run starts | log confirms `workers=2` |

### Requirement: Cleanup Lifecycle

All child processes (Playwright, webServers, Postgres) MUST be cleaned up by an idempotent async state machine with lifecycle states `starting`, `running`, `exiting`, and `cleaned`. Starting the tracked Playwright child MUST immediately create and store an awaitable child-exit promise/handle. Exit-code precedence MUST be identical across all implementations: normal completion awaits the child-exit promise and uses Playwright's exit code as the primary exit code; SIGINT uses exactly `130`; SIGTERM uses exactly `143`; these signal-derived codes take precedence even if the child reports another code; and a startup failure before Playwright is running uses the startup failure code. Cleanup errors MUST be logged/recorded but MUST NEVER replace the established primary code. Teardown MUST be idempotent and awaited before returning or calling `process.exit`; signal forwarding MUST happen only when a real signal was received, never with `undefined`. On SIGINT/SIGTERM, it MUST stop new work, forward the received signal only to the tracked child/process group, await child exit for up to 5 seconds, SIGKILL survivors, await web-server cleanup, and remove Postgres. On startup failure, it MUST stop any started children, await cleanup, and remove Postgres.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 15 | **Child handle at start** | tracked Playwright child has started | startup continues | an awaitable child-exit promise/handle is created and stored immediately; lifecycle is `starting` or `running` |
| 16 | **Normal completion** | E2E run finishes with child code `0` or non-zero | child exit is observed | lifecycle enters `exiting`; child-exit promise is awaited; Playwright's exit code becomes primary; web-server cleanup and Postgres removal are awaited; lifecycle becomes `cleaned` |
| 17 | **SIGINT during run** | user sends `SIGINT` | signal is received | primary exit code is exactly `130`, taking precedence over any child code; lifecycle enters `exiting`; the real SIGINT is forwarded, child exit is awaited up to 5 seconds, survivors are SIGKILLed, cleanup completes, and lifecycle becomes `cleaned` |
| 18 | **SIGTERM during run** | user sends `SIGTERM` | signal is received | primary exit code is exactly `143`, taking precedence over any child code; lifecycle enters `exiting`; the real SIGTERM is forwarded, child exit is awaited up to 5 seconds, survivors are SIGKILLed, cleanup completes, and lifecycle becomes `cleaned` |
| 19 | **Startup failure** | workspace build, migration, or startup fails before Playwright is running | error is raised | primary exit code is the startup failure code; started children stop, cleanup and Postgres removal are awaited, and lifecycle becomes `cleaned` |
| 20 | **Cleanup failure** | cleanup rejects after a primary child, signal, or startup failure exists | teardown completes | cleanup failure is logged/recorded without replacing the primary exit code |
| 21 | **No undefined signal** | normal completion or startup failure has no received signal | teardown runs | no signal-forwarding operation is called with `undefined` |
| 22 | **Repeated cleanup request** | signal and normal/error path overlap | teardown is requested more than once | one idempotent cleanup sequence runs and is awaited before return/`process.exit`; no duplicate kill/removal errors escape |

### Requirement: Coverage Preservation

Resource safety changes MUST preserve existing E2E coverage.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 23 | **All specs execute** | 8 E2E spec files exist | bounded run completes | all 8 files execute; zero skipped |
| 24 | **No silent skip** | worker limit reduces parallelism | run completes | no test is skipped due to resource limits alone |
| 25 | **Measured resource evidence** | a feasible E2E run is available | run is verified | measured RSS/coverage evidence and configured V8 cap are recorded without claiming unsupported guarantees |

### Requirement: Production PWA Execution

When `E2E_PWA_PRODUCTION=true`, the system MUST use a dedicated Playwright project that matches only `tests/e2e/pwa.spec.ts`. The web server for that project MUST complete `pnpm --filter web build` successfully before running `pnpm --filter web start`, and MUST inherit the configured API base URL and isolated API port. The default E2E project MUST continue using `next dev` and MUST NOT pay the production build cost.

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| 26 | **Production PWA build gate** | `E2E_PWA_PRODUCTION=true` | the PWA project starts | `next build` succeeds before `next start` is launched |
| 27 | **Production PWA coverage** | the production web server is running | `test:e2e:pwa` executes | all PWA tests run with the bounded worker default and no service-worker precondition skip |
| 28 | **Normal E2E isolation** | `E2E_PWA_PRODUCTION` is unset | the default project starts | the web server remains `next dev` and no production build is performed |

## Out of Scope

- CI workflow creation (deferred to `02-v1-infrastructure-ci-cd`)
- Test suite restructuring or spec file reorganization
- Build-phase optimization for workspace libraries
- Global `NODE_OPTIONS` changes affecting non-E2E scripts
- New npm/pnpm dependencies
