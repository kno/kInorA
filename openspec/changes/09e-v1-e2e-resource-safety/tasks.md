# Tasks: E2E Resource Safety

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

| Unit | Goal | Test cmd | Runtime harness | Rollback |
|------|------|----------|-----------------|----------|
| 1 | Worker bounds + mem caps + Docker constraints + lifecycle | `pnpm vitest run scripts/__tests__/e2e-resource-safety.test.ts` | BLOCKED — valid full-stack worker forms, Playwright/webServer lifecycle, Postgres constraints, and RSS observation require Docker or a reachable Podman machine | Revert the two production files and focused test file |

## Phase 1: Foundation + Worker Bounds

- [x] 1.1 Create `scripts/__tests__/e2e-resource-safety.test.ts` with Vitest deferred/clock helpers
- [x] 1.2 RED: `parseWorkers()` tests — `--workers=2`, `--workers 2`, `--workers=abc`, `--workers=0`, `--workers=-1`, bare `--workers`, no flag → null
- [x] 1.3 RED: Worker-default tests — CI unset→2, CI=1 + cpus.length=1→1, 2→2, 4→2
- [x] 1.4 GREEN: Add `workers` to `playwright.config.ts` — `CI ? Math.min(2, os.cpus().length) : 2`
- [x] 1.5 GREEN: Implement `parseWorkers()` in `e2e-with-stack.mjs` — validate, normalize, inject, exit non-zero on invalid

## Phase 2: Memory Caps + Docker Constraints

- [x] 2.1 RED: NODE_OPTIONS tests — default 2048, E2E_NODE_MEMORY=4096, no global mutation, RSS≠V8 cap distinction
- [x] 2.2 GREEN: Add `NODE_OPTIONS` to both webServer `env` blocks in `playwright.config.ts` using `E2E_NODE_MEMORY`
- [x] 2.3 RED: Docker classifier tests — exit 125 + unsupported-option retry; wrong status, wrong stderr, image/auth/port/daemon propagate
- [x] 2.4 GREEN: Atomic constrained `startPostgres()` — `--memory=1g --cpus=1`, retry unconstrained once for bounded 125+flag classifier, log reason, propagate rest

## Phase 3: Teardown Lifecycle

- [x] 3.1 RED: State-machine tests — starting→running→exiting→cleaned; child-exit handle stored; teardownOnce memoized
- [x] 3.2 RED: Signal tests — SIGINT→130, SIGTERM→143, precedence, real signal forwarded (never undefined), forced kill after 5s, web-server + PG cleanup
- [x] 3.3 RED: Guarded-stage tests — each stage catches own error, next runs, cleaned in finally, no cleanup error replaces primary code
- [x] 3.4 RED: Startup-failure tests — lifecycle starting, partial children, bounded wait/forced-kill, startup code preserved
- [x] 3.5 RED: Idempotency tests — concurrent signal+normal+error paths, one sequence, later signal wins exit code
- [x] 3.6 GREEN: Lifecycle state machine, SIGINT/SIGTERM handlers, deferred signal-received, guardedStage, waitAndForceKillChild, signal-aware child-wait race, selectPrimaryExitCode, startup-failure path

## Phase 4: Observability + Edge Cases

- [x] 4.1 RED: Run-start logging tests — workers + memory cap printed before Playwright
- [x] 4.2 GREEN: `console.log("[e2e] workers=N, node_memory=N MB")` before Playwright launch
- [x] 4.3 Triangle: `--workers=0/-1/abc` and bare `--workers` all exit 1; `--workers=2` and `--workers 2` pass
- [x] 4.4 Triangle: `E2E_NODE_MEMORY=invalid` falls back to 2048; `CI=true` with 1 CPU gives 1 worker
- [x] 4.5 Integration: run script with `--workers=2` and `--workers 2` — parse correctly; invalid exit non-zero
- [x] 4.6 RED remediation: config regression proves `E2E_API_PORT` controls the API health URL and child `PORT`, injected `API_BASE_URL` wins, and default port remains 4000
- [x] 4.7 GREEN remediation: derive API health URL, child `PORT`, and fallback `API_BASE_URL` consistently in `playwright.config.ts`
- [x] 4.8 Runtime remediation verification: rerun the bounded stack with an isolated `E2E_API_PORT` and record full Playwright result

## Phase 5: Full E2E and Production PWA

- [ ] 5.1 E2E: `NODE_OPTIONS="" pnpm test:e2e` — normal dev suite remains bounded; the existing PWA service-worker timeout is tracked separately because Serwist is disabled by `next dev`
- [x] 5.2 E2E: `E2E_API_PORT=4102 pnpm test:e2e:pwa` — production web build completes before `next start`; dedicated project runs all PWA tests with 2 workers and exits 0
- [x] 5.5 E2E: `E2E_API_PORT=4103 pnpm test:e2e --workers=2` — normal dev behavior remains on `next dev`; 28 passed, 2 pre-existing conditional skips, and the known PWA service-worker timeout
- [x] 5.3 Verify `stackEnv()` does NOT mutate parent NODE_OPTIONS (spec 8)
- [x] 5.4 Record peak RSS/budget evidence where feasible alongside V8 cap (spec 9, 25)

## Phase 6: Review Remediation — Startup Cancellation

- [x] 6.1 RED: deterministic cancellation tests for Postgres readiness and a running startup child
- [x] 6.2 GREEN: propagate lifecycle abort signal through readiness, migration, and workspace-library startup work
- [x] 6.3 TRIANGLE: pre-readiness abort and running-child abort both complete without the bounded readiness timeout

## Phase 7: Review Remediation — Production PWA Server Isolation

- [x] 7.1 RED: production PWA config regression for disabling reuse while preserving normal dev reuse
- [x] 7.2 GREEN: set production PWA webServer `reuseExistingServer` to false without changing normal dev behavior
- [x] 7.3 VERIFY: focused E2E resource-safety test and full build pass
