## Exploration: E2E Resource Safety

### Current State

The E2E test suite runs via `scripts/e2e-with-stack.mjs` (invoked by `pnpm test:e2e`). It orchestrates a full stack:

1. **Postgres 17 Alpine container** (no resource limits) on an ephemeral port
2. **Workspace library build** (`@kinora/contracts`, `@kinora/domain`, `@kinora/i18n` via `pnpm --filter`)
3. **Drizzle migrations** run against the ephemeral DB
4. **Playwright** starts, which in turn spawns two webServers:
   - `pnpm --filter api dev` — Fastify via `tsx src/index.ts` (watch mode)
   - `pnpm --filter web dev --hostname 127.0.0.1 --port 3000` — Next.js dev server (Turbopack)
5. Playwright runs **8 test spec files** across **~48 individual test cases**

The `playwright.config.ts` has `fullyParallel: true` with **no explicit `workers` limit**, so Playwright defaults to `os.cpus().length`.

### Investigation Evidence

| Evidence | Finding |
|----------|---------|
| `playwright.config.ts` line 5 | `fullyParallel: true` — enables inter-file parallelism |
| `playwright.config.ts` — no `workers` setting | Defaults to `os.cpus().length` = **12 workers** on this machine |
| `playwright.config.ts` line 7 | `retries: process.env.CI ? 2 : 0` — CI retries can triple the run |
| `scripts/e2e-with-stack.mjs` line 228 | `pnpm exec playwright test` — no `--workers` flag passed |
| `package.json` line 5 | `concurrently --kill-others` runs BOTH api+web dev servers |
| `scripts/e2e-with-stack.mjs` lines 141-158 | Workspace libs build runs before Playwright (CPU/memory spike) |
| `docker-compose.yml` — Postgres service | No `mem_limit`, `cpus`, or `oom_kill_disable` constraints |
| No CI workflows exist | `.github/workflows/` empty — E2E runs locally only today |
| No `NODE_OPTIONS` anywhere | No `--max-old-space-size` in any script or config |
| Machine: 12 cores / 24 GB RAM | With 12 Chromium browsers + 2 dev servers + Postgres, total RAM pressure is severe |

### Resource Budget Analysis

A single `pnpm test:e2e` run creates these concurrent processes:

| Process | Count | Est. RAM each | Total est. |
|---------|-------|--------------|------------|
| Chromium browser (Playwright worker) | up to 12 | 200-500 MB | 2.4-6 GB |
| Next.js dev server (Turbopack) | 1 | 1-3 GB | 1-3 GB |
| Fastify dev server (tsx watch) | 1 | 200-500 MB | 200-500 MB |
| Postgres 17 Alpine | 1 | 50-200 MB | 50-200 MB |
| pnpm build (workspace libs) | 3-6 (transient) | 300-800 MB each | 1-5 GB (spike) |

**Worst-case total: 4.6-14.7 GB RAM**, plus CPU contention from 12+ processes on 12 cores.

The build phase (workspace libs) spikes CPU/RAM BEFORE the browsers launch, compounding pressure. On a 24 GB machine this may survive, but on 8-16 GB machines (common for laptops or CI runners) it collapses.

### Affected Areas

- `playwright.config.ts` — workers, fullyParallel, retries all live here
- `scripts/e2e-with-stack.mjs` — no `--workers` CLI flag passed through; no memory limits on the stack
- `package.json` — the `test:e2e` script entry point
- `docker-compose.yml` — Postgres service lacks resource constraints (relevant when compose is used as an alternative test DB host)
- `.github/workflows/` (future) — CI workflow will inherit all these settings

### Approaches

1. **Cap Playwright workers explicitly** — Smallest change, biggest impact
   - Set `workers: process.env.CI ? 4 : Math.max(2, os.cpus().length - 2)` in config
   - Or pass `--workers=4` through `e2e-with-stack.mjs` CLI passthrough
   - Pros: single-line change, directly limits the primary resource drain
   - Cons: doesn't address dev server memory or build-phase spikes
   - Effort: **Low**

2. **Limit all processes via `NODE_OPTIONS` + Docker constraints**
   - Set `NODE_OPTIONS="--max-old-space-size=2048"` for dev servers
   - Add Docker `mem_limit: 1g` or `memory: 1g` to Postgres service
   - Set `NODE_OPTIONS="--max-old-space-size=4096"` for Playwright itself
   - Pros: prevents any single process from consuming machine memory
   - Cons: more changes across multiple files; memory limits may cause OOM in dev servers under real workloads
   - Effort: **Medium**

3. **Adopt a staggered/serial E2E strategy**
   - Limit workers to 1-2, or use `--workers=1` for local runs
   - Keep CI at 2-4 workers (CI runners typically have 2-4 cores)
   - Pros: safest; prevents all resource exhaustion
   - Cons: increases test wall-clock time; overkill for 8 spec files
   - Effort: **Low**

4. **Graceful resource monitoring + cleanup**
   - Add `process.memoryUsage()` checks before launching browsers
   - Pre-flight: check free RAM, reduce workers if < 4 GB free
   - Add a `--max-workers` CLI flag to `e2e-with-stack.mjs`
   - Ensure `finally` teardown also kills orphaned browser/Node processes
   - Pros: adaptive, works across environments
   - Cons: more complex; adds monitoring overhead; may be fragile
   - Effort: **Medium**

### Historical Recommendation (Superseded)

The following recommendation was produced during investigation and is preserved as evidence, but is superseded by the settled decisions below:

1. **Add `workers` to `playwright.config.ts`** with the then-proposed formula:
   ```ts
   workers: process.env.CI ? 4 : Math.max(1, os.cpus().length - 2),
   ```
   This limits local workers to 10 (safe on 12-core/24GB) and CI to 4 (standard runner size).

2. **Pass `--workers` through `e2e-with-stack.mjs`** using the then-proposed CLI handling:
   ```js
   const workerFlag = args.includes('--workers') ? [] : ['--workers', '4'];
   exitCode = await runInherit("pnpm", ["exec", "playwright", "test", ...workerFlag, ...args], env);
   ```

3. **Add `NODE_OPTIONS="--max-old-space-size=2048"`** to the webServer env for both dev servers in `playwright.config.ts`, with the earlier memory recommendation treating the cap as the principal control.

4. **Ensure teardown is comprehensive**: the current `teardown()` in `e2e-with-stack.mjs` only removes the container. The earlier investigation assumed Playwright signal propagation was sufficient; the settled lifecycle design below supersedes that assumption with explicit forwarding and awaited cleanup.

### Settled Decisions

The current proposal/spec/design supersede the historical recommendations above:

- Local and CI Playwright defaults are both `2` workers; CI is bounded as `Math.min(2, os.cpus().length)`.
- Both `--workers=2` and `--workers 2` are supported. Invalid, zero, negative, non-numeric, and missing values fail clearly and non-zero.
- `--max-old-space-size` is a scoped V8 heap cap for the two web servers, not an RSS ceiling. Peak RSS and budget evidence are observed where feasible.
- Normal completion uses a signal-aware race while awaiting the tracked child. A synchronously recorded signal switches the lifecycle to signal teardown, which forwards the real signal, waits up to 5 seconds, force-kills survivors, awaits web-server cleanup, removes Postgres, and returns `130`/`143` with signal precedence.

### Risks

- Worker caps increase wall-clock time for the suite (but 48 tests across 2 workers remains bounded)
- The CI default is capped at `Math.min(2, os.cpus().length)`, so it cannot over-provision small runners; explicit overrides remain the operator's responsibility
- The scoped V8 heap cap (`--max-old-space-size`) on dev servers may cause premature OOM if the app's baseline memory exceeds the limit during E2E. Mitigation: verify measured peak RSS and budget evidence alongside the configured cap
- The `concurrently --kill-others` in `package.json` is NOT used by E2E (it's for `pnpm dev`), but any future changes to use it for test boot would introduce double-stack risk

### Ready for Proposal

**Yes** — the root cause is identified (unbounded Playwright workers + no process memory limits), the fix is well-understood and low-risk, and the change scope is small (< 100 lines across two files).
