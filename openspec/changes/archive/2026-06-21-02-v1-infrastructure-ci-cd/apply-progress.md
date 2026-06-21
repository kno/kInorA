# Apply Progress: V1 Infrastructure CI/CD

## Summary

- Change: `02-v1-infrastructure-ci-cd`
- Mode: Strict TDD
- Delivery boundary: maintainer-approved `size:exception`
- Status: 17/17 tasks complete

## Completed Tasks

- [x] 1.1 RED: update `apps/api/src/routes/__tests__/health.test.ts` to expect exact `{"status":"ok"}` from `/health` and `/api/health`.
- [x] 1.2 GREEN: modify `apps/api/src/routes/health.ts` to register both routes with the exact JSON contract.
- [x] 1.3 REFACTOR: align `@kinora/contracts` health typing if needed without reintroducing timestamp/uptime fields.
- [x] 1.4 Create `.env.example` with `DATABASE_URL`, PostgreSQL credentials, app ports, and GHCR image/tag placeholders.
- [x] 2.1 RED: add focused tests for `scripts/start-production.mjs` command planning/readiness helpers if helpers are extracted.
- [x] 2.2 Create `docker-compose.yml` with `postgres`, `api`, and `web`, named PostgreSQL volume, health checks, ports, and image interpolation.
- [x] 2.3 Create `Dockerfile` using Node 24 and pnpm 10.17.1 to install, test/build-ready, and run monorepo services.
- [x] 2.4 Create `scripts/start-production.mjs` to ensure PostgreSQL via Compose, wait for readiness, and start production services only.
- [x] 2.5 Modify `package.json` with root `start`/service scripts while preserving `dev`, `build`, `test`, `type-check`, and `architecture`.
- [x] 2.6 Modify `apps/api/drizzle.config.ts` to read production `DATABASE_URL` for migration execution.
- [x] 3.1 Create `.github/workflows/ci-cd.yml` CI jobs for install, type-check, test, architecture guard, and build on PR/push.
- [x] 3.2 Add GHCR build/push steps gated to `main` using the workflow image tag and `GITHUB_TOKEN`.
- [x] 3.3 Add SSH deploy steps that log into GHCR on the VPS, pull the image on the VPS, and keep PostgreSQL in the VPS Compose service.
- [x] 3.4 Add deploy migration step using a one-off container from the newly pulled image; fail deploy on migration failure.
- [x] 3.5 Add post-deploy health checks for `/health` and `/api/health`; ensure deploy uses `pnpm start`, never `pnpm dev`.
- [x] 4.1 Document required GitHub secrets and VPS `.env`/directory assumptions in `.env.example` comments or deployment docs.
- [x] 4.2 Verify `pnpm install && pnpm dev`, `docker compose up -d`, `pnpm test`, `pnpm type-check`, `pnpm architecture`, and `pnpm build`.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `apps/api/src/routes/__tests__/health.test.ts` | Unit/Fastify injection | ✅ 51/51 baseline passed | ✅ Failing exact `/health` and `/api/health` contract tests written first | ✅ `pnpm --filter api test -- src/routes/__tests__/health.test.ts` passed 48/48 after implementation | ✅ Root and `/api` route plus content-type cases | ✅ Removed timestamp/uptime assertions |
| 1.2 | `apps/api/src/routes/__tests__/health.test.ts` | Unit/Fastify injection | ✅ Covered by 1.1 baseline | ✅ Covered by failing `/api/health` route and exact body tests | ✅ Same health test command passed | ✅ Two routes exercised | ✅ Shared immutable response |
| 1.3 | `apps/api/src/routes/__tests__/health.test.ts` | Type contract via route tests | ✅ Covered by 1.1 baseline | ✅ Exact-body tests failed while contract still included extra fields | ✅ Same health test command passed | ✅ Contract used for both route bodies | ✅ `HealthResponse` reduced to `status: "ok"` only |
| 1.4 | N/A | Config/docs | N/A (new file) | ➖ Config-only; no behavior branch to drive by unit test | ✅ Verified by `pnpm type-check`, `pnpm build`; Docker unavailable locally | ➖ Single structural output | ✅ Comments document secrets/VPS assumptions |
| 2.1 | `apps/api/src/ops/__tests__/start-production.test.js` | Unit | N/A (new behavior) | ✅ Import failed before `scripts/start-production.mjs` existed | ✅ Startup helper tests passed 51/51 API tests | ✅ Default and configured credentials plus blank project validation | ✅ Extracted pure planning helpers |
| 2.2 | `apps/api/src/ops/__tests__/start-production.test.js` | Unit/config | N/A (new file) | ✅ Plan tests required Compose project, postgres readiness, and services | ✅ Startup helper tests passed | ✅ Readiness uses default and custom DB credentials | ✅ Compose keeps PostgreSQL as named volume/service |
| 2.3 | N/A | Config | N/A (new file) | ➖ Dockerfile structural; no local Docker available for RED/GREEN | ✅ `pnpm build` passed; Docker daemon/CLI unavailable for image build | ➖ Single structural output | ✅ Uses Node 24.17.0 and pnpm 10.17.1 |
| 2.4 | `apps/api/src/ops/__tests__/start-production.test.js` | Unit | N/A (new file) | ✅ Missing script import failed first | ✅ Startup helper tests passed | ✅ Multiple command-plan cases | ✅ Runtime execution isolated from pure plan helpers |
| 2.5 | `apps/api/src/ops/__tests__/start-production.test.js` | Unit/command contract | ✅ Existing root scripts preserved by `pnpm test`, `type-check`, `architecture`, `build` | ✅ Plan tests described production-only Compose flow before root start script changed | ✅ Verification commands passed | ✅ Root `start` and service starts are distinct from `dev` | ✅ Existing scripts preserved |
| 2.6 | N/A | Config | Existing build/type-check baseline passed | ➖ Drizzle config structural; production migration behavior verified through workflow command | ✅ `pnpm type-check` and `pnpm build` passed | ➖ Single env-driven config path | ✅ Added `DATABASE_URL` with local fallback |
| 3.1 | N/A | CI config | N/A (new file) | ➖ GitHub Actions config-only; no local Actions runner | ✅ Workflow steps match required commands; local equivalents passed | ➖ Single workflow output | ✅ CI and deploy separated by jobs/gates |
| 3.2 | N/A | CI config | N/A (new file) | ➖ GitHub Actions config-only | ✅ GHCR build/push is gated to `main`; local build passed | ➖ Single workflow output | ✅ Lowercases GHCR image name |
| 3.3 | N/A | CI config | N/A (new file) | ➖ SSH deploy config-only | ✅ Workflow deploy script logs into GHCR on VPS and pulls image on VPS | ➖ Single workflow output | ✅ PostgreSQL remains Compose-managed on VPS |
| 3.4 | N/A | CI config | N/A (new file) | ➖ Migration deploy config-only | ✅ Workflow uses one-off container from pulled image and `set -euo pipefail` | ➖ Single workflow output | ✅ Migration failure fails deploy |
| 3.5 | N/A | CI config | N/A (new file) | ➖ Health-check deploy config-only | ✅ Workflow calls `/health` and `/api/health`; local route tests passed | ✅ Both health routes tested | ✅ Deploy uses `pnpm start`; no `pnpm dev` in deploy path |
| 4.1 | N/A | Docs/config | N/A | ➖ Documentation-only | ✅ `.env.example` contains secret and VPS assumptions | ➖ Single docs output | ✅ Kept docs colocated with env placeholders |
| 4.2 | Verification commands | System | N/A | ➖ Verification task; no production code | ✅ See verification log below | ➖ Multiple command outcomes captured | ✅ Docker/dev blockers documented |

## Test Summary

- Total tests written: 6 new/updated behavioral assertions across health and startup planning.
- Total tests passing: `pnpm -r test` passed all workspace tests.
- Layers used: Unit/Fastify injection and unit command-planning tests.
- Approval tests: None — no pure refactoring-only task.
- Pure functions created: `resolveComposeProjectName`, `createProductionStartPlan`, `startProduction` orchestration wrapper.

## Verification Log

| Command | Outcome |
|---------|---------|
| `pnpm --filter api test -- src/routes/__tests__/health.test.ts` before implementation | Failed as expected: `/health` had extra `timestamp`/`uptime`; `/api/health` returned 404. |
| `pnpm --filter api test -- src/routes/__tests__/health.test.ts` after implementation | Passed: 6 files, 48 tests. |
| `pnpm --filter api test -- src/ops/__tests__/start-production.test.js` before script | Failed as expected: missing `scripts/start-production.mjs`. |
| `pnpm --filter api test -- src/ops/__tests__/start-production.test.js` after implementation | Passed: 7 files, 51 tests. |
| `pnpm -r test` | Passed. |
| `pnpm type-check` | Passed. |
| `pnpm architecture` | Passed. |
| `pnpm build` | Passed. |
| `pnpm install --frozen-lockfile && docker compose config` | `pnpm install` passed; Docker verification blocked because `docker` command is not installed in this environment. |
| `pnpm dev` | Blocked by pre-existing local servers/ports: API port 4000 in use and another Next dev server already running on port 3000. |

## Deviations and Issues

- No design deviation. The deploy path builds/pushes to GHCR, logs into GHCR from the VPS, pulls the image on the VPS, runs migrations from a one-off container based on the newly pulled image, and keeps PostgreSQL data in the VPS Compose service/volume.
- Local Docker verification could not run because the environment does not have the `docker` CLI installed.
- `pnpm dev` could not complete because existing local processes already occupy ports 3000/4000.

## Post-Review Remediation

### Findings Fixed

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| 1 | `ssh-keyscan` TOFU at deploy time | CRITICAL | Replaced with pinned `VPS_KNOWN_HOSTS` secret; workflow fails immediately if secret is missing. |
| 2 | Inline unescaped env in SSH command | CRITICAL | Replaced with base64-encoded shell-safe env payload: `printf %q` on runner → `base64` → SSH command-line var → decoded `eval` on remote. No shell injection path through env values. |
| 3 | No PG readiness wait before migrations | CRITICAL | Added bounded retry loop (30 attempts × 2s) using `docker compose exec postgres pg_isready` before migration step. Logs postgres logs on exhaustion. |
| 4 | `PRODUCTION_BASE_URL` falls back to weak default | Warning | Removed `|| 'http://127.0.0.1:4000'` fallback; secret is now required. Kept `VPS_DEPLOY_DIR` and `VPS_PORT` defaults as they have safe fallbacks. |
| 5 | Sparse error messages in `start-production.mjs` | Warning | Failed-step errors now include full command line, exit code, and captured stderr/stdout. |
| 6 | Startup ordering coverage | Warning | Added two tests: (a) label-ordering assertion independent of specific args, (b) bounded retry bounds check. |
| 7 | `packages: write` at top-level workflow scope | Warning | Moved to deploy job only; top-level scope is now `contents: read` only. |

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `.github/workflows/ci-cd.yml` | Modified | TOFU→pinned known_hosts, base64 env payload, PG readiness wait, required `PRODUCTION_BASE_URL`, job-scoped permissions |
| `scripts/start-production.mjs` | Modified | Error messages include command line, exit code, and captured output |
| `.env.example` | Modified | Documented `VPS_KNOWN_HOSTS` secret requirement |
| `apps/api/src/ops/__tests__/start-production.test.js` | Modified | Added ordering-dependent and retry-bounds tests |

### New Secrets Required

- `VPS_KNOWN_HOSTS`: Pinned VPS host key (output of `ssh-keyscan -p <port> <host>`), stored as a GitHub secret. Must be provisioned before next deploy.

### Verification

| Command | Outcome |
|---------|---------|
| `pnpm -r test` | ✅ 53 API tests, 13 web, 3 domain — all passed (2 new tests added). |
| `pnpm type-check` | ✅ All packages passed. |
| `pnpm architecture` | ✅ No dependency violations; negative guard passed. |
| `pnpm build` | ✅ Done. |

## Workload / PR Boundary

- Mode: `size:exception`
- Current work unit: full task set
- Boundary: all phases from health contract through Docker/startup and CI/CD deploy in one maintainer-approved review unit.
- Estimated review budget impact: above 400 lines by design; explicitly accepted as `size:exception`.
