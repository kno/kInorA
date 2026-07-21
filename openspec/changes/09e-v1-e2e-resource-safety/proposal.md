# Proposal: E2E Resource Safety

## Intent

`pnpm test:e2e` runs Playwright with `fullyParallel: true` and no `workers` limit, defaulting to `os.cpus().length` (12 Chromium browsers on this machine). Combined with two unbounded dev servers (Next.js + Fastify) and a Postgres container with no memory ceiling, worst-case RAM is 4.6–14.7 GB. On 8–16 GB machines (laptops, CI runners) this can collapse the developer machine. The fix must bound resources without deleting tests or reducing coverage, while distinguishing configured V8 heap from measured process RSS.

## Scope

### In Scope
- Bounded Playwright workers via config and CLI passthrough
- Memory-limited E2E web servers (Next.js, Fastify) via `NODE_OPTIONS`
- CLI `--workers` override in `e2e-with-stack.mjs`
- Postgres container resource limits via Docker flags
- Teardown hardening for orphaned processes
- Observability: log worker count and memory limits at run start
- Production-only PWA E2E mode that builds the web app before `next start`

### Out of Scope
- CI workflow creation (future `02-v1-infrastructure-ci-cd` work)
- General test suite restructuring or spec file reorganization
- Workspace library build optimization (build-phase spike is transient)
- Global `NODE_OPTIONS` change affecting non-E2E scripts

## Capabilities

### New Capabilities
- `e2e-resource-safety`: Resource orchestration for E2E test runs — worker bounds, process memory limits, container constraints, and teardown lifecycle.

### Modified Capabilities

None — no existing spec-level requirements change.

## Approach

1. **`playwright.config.ts`**: Add `workers` with local default `2` and CI default `Math.min(2, os.cpus().length)`. Add scoped `NODE_OPTIONS: "--max-old-space-size=2048"` to both webServer `env` blocks, controlled by `E2E_NODE_MEMORY`. When `E2E_PWA_PRODUCTION=true`, replace only the web dev command with `pnpm --filter web build && pnpm --filter web start --hostname 127.0.0.1 --port 3000` and expose a dedicated `pwa-production` project matching `pwa.spec.ts`; the default project remains on `next dev`.
2. **`scripts/e2e-with-stack.mjs`**: Accept and validate both `--workers=2` and `--workers 2` forms, rejecting zero, negative, non-numeric, and bare values with a clear non-zero error. Log effective bounds at run start. Attempt Postgres startup atomically with `--memory=1g --cpus=1`; fall back exactly once, and only when the constrained command exits `125` and stderr contains an unsupported-option signature (`unknown flag`, `unknown option`, `flag provided but not defined`, or `unrecognized option`) together with `--memory` or `--cpus`. Image pull/auth, port conflict, invalid image, daemon unavailable, generic invalid argument, and all other failures propagate without fallback; log the classified fallback reason.
3. **Teardown**: Implement an idempotent async state machine with lifecycle states `starting`, `running`, `exiting`, and `cleaned`. Starting the tracked Playwright child MUST immediately create and store an awaitable child-exit promise/handle. Normal completion awaits that promise; Playwright's exit code is the primary code. SIGINT establishes primary code `130`, SIGTERM establishes primary code `143`, and either signal-derived code takes precedence over any child code. A startup failure before Playwright is running establishes the startup failure code. Every path stops new work, awaits web-server cleanup and Postgres removal, and records cleanup errors without replacing the established primary code. Teardown is idempotent and awaited before returning or `process.exit`; signal forwarding occurs only for a real received signal, never `undefined`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `playwright.config.ts` | Modified | Add `workers`, `NODE_OPTIONS` in webServer env |
| `scripts/e2e-with-stack.mjs` | Modified | CLI `--workers` passthrough, Docker memory flags, observability logging |
| `package.json` | Modified | Add `test:e2e:pwa`; keep `test:e2e` unchanged |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Worker cap increases wall-clock time | Low | The safe defaults trade parallelism for host stability; explicit `--workers` remains available |
| Configured V8 heap cap is mistaken for total memory safety | Medium | Measure peak RSS where feasible and report it alongside the configured V8 cap; do not claim an RSS ceiling from `NODE_OPTIONS` |
| Docker resource flags are unsupported | Low | Retry unconstrained exactly once only for exit 125 plus a resource-flag-specific unsupported-option signature; log the fallback reason |
| Child exit and cleanup race produces the wrong status | Medium | Create the awaitable child-exit handle before lifecycle transitions, define signal/startup precedence explicitly, and await one idempotent teardown promise before returning |

## Rollback Plan

Revert `playwright.config.ts` and `scripts/e2e-with-stack.mjs` changes. Remove the `workers` field (returns to default), remove `NODE_OPTIONS` from webServer env, remove Docker flags. No data or schema changes involved.

## Dependencies

None — pure config/script change with no new packages.

## Success Criteria

- [ ] `pnpm test:e2e` passes with bounded workers (local default `2`; CI default `Math.min(2, os.cpus().length)`)
- [ ] Normal dev suite remains resource-safe with `2` workers; existing conditional skips remain tied to missing preconditions
- [ ] `pnpm test:e2e:pwa` builds the web app before starting production and passes all PWA tests with `2` workers
- [ ] Invalid, zero, negative, non-numeric, and bare `--workers` values exit non-zero with clear errors
- [ ] Measured peak RSS and budget evidence are collected where feasible, alongside the configured V8 heap cap; no RSS ceiling is overclaimed
- [ ] Postgres uses constrained startup when supported and falls back exactly once only for the bounded exit-125/resource-flag classifier; unrelated startup failures propagate without retry
- [ ] The tracked Playwright child creates an awaitable exit promise/handle immediately at start; lifecycle states are `starting` → `running` → `exiting` → `cleaned`
- [ ] Normal completion awaits the child-exit promise and uses Playwright's exit code; SIGINT uses exactly 130 and SIGTERM exactly 143, both taking precedence over any child code; startup failure before Playwright runs uses the startup failure code
- [ ] Cleanup errors are logged/recorded but never replace the established primary code; teardown is idempotent and awaited before return/`process.exit`, and signal forwarding never receives `undefined`
- [ ] Normal completion, SIGINT, SIGTERM, and startup failure follow separate awaited cleanup transitions and force-kill signal-path survivors after 5 seconds
- [ ] Run log prints worker count, V8 memory cap, and Docker fallback reason when applicable
