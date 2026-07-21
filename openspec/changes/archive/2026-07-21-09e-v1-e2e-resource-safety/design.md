# Design: E2E Resource Safety

## Technical Approach

Bound Playwright workers with explicit local/CI defaults, scope `NODE_OPTIONS` to web servers, attempt Docker constraints atomically, implement an idempotent async teardown state machine, and log effective config at run start. Add an opt-in production PWA project so Serwist runs under `next start` without forcing every E2E test through a production build. Production changes stay within `playwright.config.ts`, `scripts/e2e-with-stack.mjs`, and the root script entry point; focused regression coverage lives in `scripts/__tests__/e2e-resource-safety.test.ts`. The change adds no dependencies or CI workflow, does not set global `NODE_OPTIONS`, and does not modify E2E specs.

## Architecture Decisions

### Decision: Worker Default Policy

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Local `2`; CI `Math.min(2, cpus)` | Safe default while retaining a bounded CI adaptation; `--workers` override compensates | **Chosen** |
| Adaptive RAM probe | Fragile in containers; `os.totalmem` unreliable | Rejected |

**Rationale**: The previous formula produced 10 workers on this 12-core machine, generating excessive Chromium concurrency on top of the dev servers and Postgres. A local default of 2 and CI default of `Math.min(2, os.cpus().length)` reduce that pressure while allowing explicit opt-in through `--workers=N` or `--workers N`. These defaults are resource-safety controls, not guarantees about total host RSS.

**CI formula**: `Math.min(2, os.cpus().length)`. The hard cap prevents over-provisioning on small runners while preserving a valid worker count on single-core environments.

### Decision: CLI Override — Invalid Values Exit Non-Zero

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Parse both `--workers=N` and `--workers N`, validate N ≥ 1, exit non-zero on invalid | Matches spec requirement; prevents misconfiguration silently | **Chosen** |
| Warn and fall back to default | Hides bad config; spec says MUST exit non-zero | Rejected |
| Let Playwright validate | No logging; unclear error message | Rejected |

In `e2e-with-stack.mjs`: parse `process.argv` for `--workers=N` or `--workers N`. Validate N is a positive integer ≥ 1. If the flag is present but bare, zero, negative, or non-numeric, log a clear error and return a non-zero result before startup. Inject the normalized value into `pnpm exec playwright test` args without double-injecting.

### Decision: Scoped NODE_OPTIONS

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Set `NODE_OPTIONS` per webServer in `playwright.config.ts` env | Scoped to Playwright child processes only | **Chosen** |
| Export `NODE_OPTIONS` in orchestrator `env()` | Leaks to migrations, workspace build | Rejected |
| Global `NODE_OPTIONS` in shell | Affects all Node processes outside E2E | Rejected |

Playwright's `webServer[].env` is merged with `process.env` and passed only to that child. The config sets `NODE_OPTIONS` in each webServer entry's `env` block. `E2E_NODE_MEMORY` env var (default `2048`) controls the cap. `stackEnv()` must NOT set `NODE_OPTIONS` — it mutates the parent.

**Memory verification note**: `--max-old-space-size` caps the V8 heap, not total process RSS. A process with a 2048 MB heap cap may still consume more RSS due to native allocations, JIT code, and runtime overhead. Verification should observe peak RSS with `ps` or Activity Monitor and record budget evidence where feasible, alongside the configured V8 cap. The design MUST NOT claim that `NODE_OPTIONS` guarantees an RSS ceiling.

### Decision: Isolated API Port Consistency

The orchestrator already derives the API child `PORT` and injected `API_BASE_URL` from `E2E_API_PORT`, but Playwright's API health probe previously hardcoded port `4000`. This split configuration made an isolated run fail against an unrelated process already using port 4000 even though the orchestrator selected a different API port.

`playwright.config.ts` now resolves one `apiPort` from `E2E_API_PORT` with a `4000` fallback. That value controls the API webServer health URL and its explicit child `PORT`. The web child preserves an existing injected `API_BASE_URL`; only when it is absent does the config derive `http://localhost:<apiPort>`. This keeps orchestrator injection authoritative while ensuring direct Playwright configuration has one consistent fallback.

### Decision: Production PWA Project

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Opt-in `E2E_PWA_PRODUCTION=true` with a dedicated Playwright project and build-then-start web command | Production build cost is paid only by the PWA command; normal E2E keeps `next dev` | **Chosen** |
| Make every E2E project use `next build && next start` | Reliable service worker, but adds a production build to unrelated tests and changes normal developer behavior | Rejected |
| Keep PWA on `next dev` and suppress the timeout | Hides the Serwist/dev-mode precondition and loses the live service-worker assertion | Rejected |

The production web server command uses `&&`, so `next start` cannot launch unless `next build` exits successfully. It inherits the same API environment as the dev web server, including the isolated `E2E_API_PORT` fallback or an explicitly injected `API_BASE_URL`. Playwright owns and tears down this web server through the existing tracked child lifecycle.

### Decision: Docker Capability Probing — Atomic Attempt

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Attempt `<runtime> run` with `--memory=1g --cpus=1` as one command; on failure, retry without flags | Atomic: either all constraints apply or none; no partial state | **Chosen** |
| Probe `run --help` for flag presence | Heuristic; help text may not reflect actual runtime support | Rejected |
| Always pass flags, catch errors | Partial failure leaves some flags applied | Rejected |
| Skip constraints entirely | Unsafe on constrained machines | Rejected |

Before `startPostgres()`, attempt `<runtime> run -d --name ... --memory=1g --cpus=1 ...`. If the command succeeds (status 0), constraints are applied. A bounded classifier MAY authorize exactly one fallback only when `status === 125` and stderr matches both an unsupported-option signature (`unknown flag`, `unknown option`, `flag provided but not defined`, or `unrecognized option`) and `--memory` or `--cpus`. The classifier MUST use stderr, not generic stdout or a broad status-only heuristic. Image pull, authentication, port conflict, invalid image, daemon unavailable, generic invalid argument, and all other failures are thrown without retry. The fallback reason is logged before the one unconstrained attempt. This avoids partial-flag states where one resource flag works but another does not.

**Startup failure semantics preserved**: If the Postgres `run` command fails for reasons other than unsupported flags, `startPostgres()` throws, the error path records the failure code, and the awaited teardown completes before returning that code.

### Decision: Signal Forwarding, Exit Precedence, and Teardown Ordering

The current teardown only removes the container. The signal handler calls `teardown()` then exits, which does not forward signals to the Playwright child or wait for cleanup.

**New teardown lifecycle**:

1. **Start and track**: initialize lifecycle state as `starting`; start the tracked Playwright child and immediately create/store an awaitable child-exit promise/handle. Transition to `running` only when Playwright has reached its running milestone, not merely when `spawn` succeeds.
2. **Signal capture**: each SIGINT/SIGTERM handler synchronously records `receivedSignal` and its derived primary code (`130` or `143`) before starting or joining teardown. The signal handler then requests the shared teardown promise and never relies on a later teardown argument to preserve signal intent.
3. **Normal completion**: if lifecycle reached `running`, set `exiting`, stop new work, and await a signal-aware race between the tracked child-exit promise and a signal-received awaitable. If child exit wins while no signal is recorded, establish Playwright's exit code as the primary code, do not forward a signal, await web-server cleanup, remove the container, set `cleaned`, and return the established primary code. If a signal wins, normal flow MUST stop treating child exit as its sole completion path and MUST enter signal teardown.
4. **Signal teardown**: the signal handler synchronously records the signal and resolves the signal-received awaitable before starting or joining the memoized teardown. Set `exiting`, stop new work, and always select the recorded signal-derived code before observing child termination, even when normal teardown had already begun or child exit was already observed. Forward only the real received signal to the tracked Playwright child/process group. The shared teardown runs four guarded sequential stages: signal-aware child wait, timeout/forced kill, web-server cleanup, and Postgres removal. Each stage catches and records its own error, then continues to the next stage. The final `finally` block sets `cleaned`.
5. **Startup failure**: if failure occurs while lifecycle is `starting`, record and preserve the startup failure code, set `exiting`, stop new work, and explicitly stop every child/process group already started. Use the same bounded signal-aware wait and timeout/forced-kill helper before web-server cleanup and Postgres removal. Do not use a child-exit code for this path and do not forward a signal unless one was actually recorded.
6. **Cleanup failure precedence**: child-exit wait/rejection, kill failure, web-server cleanup failure, and Postgres removal failure are logged/recorded by their individual stages, but never replace the established primary signal, startup-failure, or normal-completion code.
7. **Repeated requests**: all paths share one memoized teardown promise; subsequent signal/error/finally calls await the same promise and do not duplicate cleanup. A later signal still updates the synchronously recorded signal fields, and final exit-code selection checks `receivedSignal` first.
8. **Process exit**: the top-level entry point returns only after teardown reaches `cleaned`; it MUST NOT call `process.exit` before awaited cleanup.

**Process group**: Track the Playwright child and its process group. Forward the signal explicitly to the child/process group so Playwright can clean up its webServers; `stdio: "inherit"` alone does not guarantee child signal delivery in all shells.

**Exit-code precedence**: Final selection always checks `receivedSignal` first (`SIGINT` → `130`, `SIGTERM` → `143`), regardless of teardown start order or child-exit observation. If no signal was received, a startup failure while state is `starting` uses its preserved startup failure code. Only normal completion from `running` uses the awaited Playwright child exit code. Cleanup errors never replace an established primary code.

## Data Flow

```
CLI: pnpm test:e2e --workers 2
         │
         ▼
  e2e-with-stack.mjs
    ├─ detectRuntime()              → docker | podman
    ├─ parse --workers 2             → validated (integer ≥ 1), normalized into args
    ├─ startPostgres(runtime)        → attempt with --memory=1g --cpus=1
    │    └─ unsupported flags only → retry without flags, log fallback reason
    ├─ waitForPostgres()            → poll pg_isready
    ├─ migrate()                    → pnpm --filter api db:migrate
    ├─ buildWorkspaceLibs()         → pnpm --filter @kinora/* build
    ├─ log("[e2e] workers=2, node_memory=2048 MB")
    └─ runInherit("pnpm", ["exec", "playwright", "test", "--workers=2"], env)
              │
              ▼
      playwright.config.ts
        ├─ workers: CI ? Math.min(2, os.cpus().length) : 2 (CLI override wins)
        ├─ apiPort: E2E_API_PORT ?? 4000
        ├─ webServer[0]: api health + child PORT use apiPort
        └─ webServer[1]: injected API_BASE_URL ?? http://localhost:<apiPort>
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `scripts/e2e-with-stack.mjs` | Modify | Add `--workers` parsing/validation (exit non-zero on invalid), `startPostgres()` atomic Docker flag attempt with fallback, run-start logging, explicit signal forwarding with timeout, tracked child process reference |
| `playwright.config.ts` | Modify | Add local/CI `workers` defaults, scoped `NODE_OPTIONS`, consistent `E2E_API_PORT` health/child environment derivation, and opt-in production PWA project |
| `package.json` | Modify | Add `test:e2e:pwa` command that enables production PWA mode and selects only the dedicated project |
| `scripts/__tests__/e2e-resource-safety.test.ts` | Add | Focused regression coverage for worker parsing, memory configuration, Docker fallback, lifecycle teardown, signals, cleanup continuation, and observability |

## Interfaces / Contracts

```ts
// playwright.config.ts — new fields only
workers: process.env.CI ? Math.min(2, os.cpus().length) : 2,

// Each webServer entry gains:
env: {
  NODE_OPTIONS: `--max-old-space-size=${process.env.E2E_NODE_MEMORY ?? '2048'}`,
  // ...existing env entries
}

// e2e-with-stack.mjs — --workers parsing (must exit non-zero on invalid)
function parseWorkers(args) {
  const token = args.find((arg) => arg === "--workers" || arg.startsWith("--workers="));
  if (token === undefined) return null; // no override, use config default
  const idx = args.indexOf(token);
  const raw = token.includes("=") ? token.slice(token.indexOf("=") + 1) : args[idx + 1];
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`[e2e] Invalid --workers value: "${raw ?? ""}". Must be a positive integer.`);
  }
  return n;
}

// e2e-with-stack.mjs — atomic Docker constraint attempt
function startPostgres(runtime) {
  const baseArgs = ["run", "-d", "--name", CONTAINER_NAME, /* env/port args */, PG_IMAGE];
  const constrainedArgs = ["run", "-d", "--name", CONTAINER_NAME, "--memory=1g", "--cpus=1", /* env/port args */, PG_IMAGE];
  let result = run(runtime, constrainedArgs);
  if (result.status !== 0 && isUnsupportedResourceFlagsFailure(result)) {
    console.log(`[e2e] Docker resource flags unsupported; retrying unconstrained: ${fallbackReason(result)}`);
    result = run(runtime, baseArgs);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to start Postgres container:\n${result.stderr || result.stdout}`);
  }
}

function isUnsupportedResourceFlagsFailure(result) {
  const stderr = result.stderr ?? "";
  return result.status === 125
    && /unknown flag|unknown option|flag provided but not defined|unrecognized option/i.test(stderr)
    && /--memory|--cpus/.test(stderr);
}

// e2e-with-stack.mjs — lifecycle and exit-code precedence
let child = null;
let childExit = null;
let lifecycle = "starting"; // starting | running | exiting | cleaned
let receivedSignal = null;
let signalExitCode = null;
let signalReceived = deferred();
let startupFailureCode = null;
let normalExitCode = null;
let primaryExitCode = null;
let teardownPromise = null;
const cleanupErrors = [];

function startPlaywright() {
  lifecycle = "starting";
  child = spawnTrackedPlaywright();
  childExit = awaitableChildExit(child); // create immediately after start
  await playwrightReachedRunning(child);
  if (lifecycle === "starting") lifecycle = "running";
}

function onSignal(signal) {
  receivedSignal = signal;
  signalExitCode = signal === "SIGINT" ? 130 : 143;
  signalReceived.resolve(signal);
  void teardownOnce();
}

function selectPrimaryExitCode() {
  if (receivedSignal) return signalExitCode;
  if (startupFailureCode !== null) return startupFailureCode;
  return normalExitCode;
}

function recordCleanupError(stage, error) {
  cleanupErrors.push({ stage, error });
  console.error(`[e2e] cleanup failed at ${stage}:`, error);
}

async function guardedStage(stage, operation) {
  try {
    await operation();
  } catch (error) {
    recordCleanupError(stage, error);
  }
}

async function waitAndForceKillChild() {
  if (!child || !childExit) return;
  if (receivedSignal) {
    await guardedStage("signal-forwarding", async () => {
      forwardToChildProcessGroup(child, receivedSignal);
    });
  }
  await guardedStage("child-exit-wait", async () => {
    await waitForExit(child, 5000);
  });
  await guardedStage("timeout-forced-kill", async () => {
    if (!childExited(child)) await killSurvivors(child);
  });
  await guardedStage("child-exit-rejection", async () => {
    await childExit;
  });
}

async function teardownOnce() {
  if (teardownPromise) return teardownPromise;
  teardownPromise = (async () => {
    const teardownStartState = lifecycle;
    lifecycle = "exiting";
    stopNewWork();
    try {
      if (teardownStartState === "running" && childExit) {
        await guardedStage("signal-aware-child-wait", async () => {
          const outcome = await Promise.race([
            childExit.then((code) => ({ kind: "child", code })),
            signalReceived.promise.then((signal) => ({ kind: "signal", signal })),
          ]);
          if (outcome.kind === "child" && !receivedSignal) normalExitCode = outcome.code;
        });
      }
      await waitAndForceKillChild();
      await guardedStage("web-server-cleanup", awaitWebServerCleanup);
      await guardedStage("postgres-removal", removePostgres);
      // Re-evaluate after every awaited stage so a signal arriving during teardown wins.
      primaryExitCode = selectPrimaryExitCode();
      return primaryExitCode;
    } finally {
      lifecycle = "cleaned";
    }
  })();
  return teardownPromise;
}

async function failDuringStartup(error) {
  if (lifecycle === "starting") startupFailureCode = error.exitCode ?? 1;
  // teardownOnce uses the same bounded child wait/kill stages for any partial startup.
  await teardownOnce();
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (Vitest) | `--workers` parsing: both valid forms, zero, negative, non-numeric, missing value | Extract `parseWorkers()` into a testable function; assert both forms normalize and every invalid value exits non-zero with a clear error |
| Unit (Vitest) | Worker defaults | Mock `os.cpus()` and `CI`; assert local is 2 and CI is `Math.min(2, cpus)` |
| Unit (Vitest) | Docker constraint fallback: supported, bounded unsupported, and unrelated failures | Mock constrained `run` results; assert exactly one retry only for status 125 plus the resource-flag-specific unsupported-option patterns, log the reason, and propagate positive/negative examples without retry |
| Unit (Vitest) | Signal forwarding and teardown state machine | Mock child/process group, timers, web-server cleanup, and Postgres removal; assert distinct normal/signal/startup orderings, no undefined signal, idempotent awaited cleanup, forced kill after 5 seconds, and primary exit-code preservation when cleanup fails |
| Unit (Vitest) | Guarded teardown continuation | Reject child-exit wait, make forced kill reject, and make child cleanup, web-server cleanup, or Postgres removal reject independently; assert every later stage still runs, each error is recorded, `cleaned` is set in the final `finally`, and no cleanup error replaces the primary code |
| Unit (Vitest) | Lifecycle race precedence | Deliver SIGINT/SIGTERM while normal completion is awaiting the tracked child; assert the signal-aware race resolves the normal wait, signal teardown forwards the real signal, waits 5 seconds, force-kills survivors, awaits web-server/Postgres cleanup, and returns `130`/`143`. Also deliver a signal after child exit is observed; assert synchronous signal recording and signal precedence. Fail startup while state is `starting` after a child/process group has started; assert the same bounded wait/forced-kill helper runs before web-server/Postgres cleanup, and the startup-failure code wins over the child exit code and is preserved through cleanup |
| Unit (Vitest) | Teardown idempotency | Request teardown concurrently from signal, normal completion, and error/finally paths; assert one memoized sequential stage sequence runs, all callers await it, cleanup is not duplicated, and later signal recording still wins exit-code selection |
| Integration | `e2e-with-stack.mjs` with `--workers=2` and `--workers 2` | Run the parser/orchestrator; verify log output shows `workers=2` and Playwright receives the normalized flag |
| Integration | Invalid worker values | Run with `--workers=0`, `--workers=-1`, `--workers=abc`, and bare `--workers`; verify non-zero exit and clear error |
| E2E | All 8 spec files execute with bounded workers | `pnpm test:e2e` with default config; assert zero skipped, exit 0 |
| E2E | SIGINT/SIGTERM cleanup | Start run, send each signal while normal completion is waiting for the child and after child exit is observable, verify forwarding, forced-kill behavior after 5 seconds, awaited cleanup, no orphaned Chromium/Node, container removal, and 130/143 |
| Evidence | Memory and coverage | Where feasible, record peak RSS/budget observation plus configured V8 cap, and verify all 8 specs execute with zero skipped |

## Threat Matrix

This change involves shell commands, subprocesses, and process integration.

| Boundary | Applicability | Design Response | RED Test |
|----------|--------------|-----------------|----------|
| Documentation-like paths | N/A — no file classification or executable path injection | — | — |
| Git repository selection | N/A — no git operations in this change | — | — |
| Commit state | N/A — no git index manipulation | — | — |
| Push state | N/A — no push operations | — | — |
| PR commands | N/A — no PR automation | — | — |
| Shell commands (new) | **Applicable** — `--workers` parsed from CLI, Docker flags attempted atomically | Validate `--workers` is integer ≥ 1 before injection; atomic constraint attempt with fallback | Test: `--workers=abc` → exit 1; `--workers=0` → exit 1; `--workers` alone → exit 1; Docker unsupported → fallback + log |
| Subprocess spawning | **Applicable** — `spawn`/`spawnSync` for container runtime, Postgres start, Playwright execution | Preserve existing `runInherit` pattern; track child reference for signal forwarding | Test: missing runtime → exit 1; Playwright failure → exit with code; Docker constraint failure → fallback succeeds |
| Process integration | **Applicable** — signal propagation to Playwright, webServers, Postgres | Explicit signal forwarding to tracked child; timeout-based teardown; container removal | Test: send SIGINT → child killed → teardown runs → exit 130; no orphaned processes |

## Migration / Rollout

No migration required. Config-only change. Rollback: revert both files, workers return to defaults, no data or schema involved.

## Open Questions

- [ ] Validate the 2048 MB V8 cap with measured peak RSS/budget evidence where feasible; do not infer an RSS guarantee from the cap.
- [ ] Decide whether the `--workers` override should be documented outside the SDD artifacts; it remains the escape hatch for higher-capacity machines.
