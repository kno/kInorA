# Tasks: V1 Infrastructure CI/CD

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650-900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 health/local baseline → PR 2 Docker/startup → PR 3 CI/CD deploy |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Local baseline and health contracts | PR 1 | Tests with API route behavior; docs for first-run env. |
| 2 | Docker, PostgreSQL, production start | PR 2 | Depends on PR 1; Compose and startup verification. |
| 3 | CI, GHCR, SSH deploy, migrations | PR 3 | Depends on PR 2; workflow and deploy verification. |

## Phase 1: Local Baseline and Health

- [x] 1.1 RED: update `apps/api/src/routes/__tests__/health.test.ts` to expect exact `{"status":"ok"}` from `/health` and `/api/health`.
- [x] 1.2 GREEN: modify `apps/api/src/routes/health.ts` to register both routes with the exact JSON contract.
- [x] 1.3 REFACTOR: align `@kinora/contracts` health typing if needed without reintroducing timestamp/uptime fields.
- [x] 1.4 Create `.env.example` with `DATABASE_URL`, PostgreSQL credentials, app ports, and GHCR image/tag placeholders.

## Phase 2: Docker and Production Startup

- [x] 2.1 RED: add focused tests for `scripts/start-production.mjs` command planning/readiness helpers if helpers are extracted.
- [x] 2.2 Create `docker-compose.yml` with `postgres`, `api`, and `web`, named PostgreSQL volume, health checks, ports, and image interpolation.
- [x] 2.3 Create `Dockerfile` using Node 24 and pnpm 10.17.1 to install, test/build-ready, and run monorepo services.
- [x] 2.4 Create `scripts/start-production.mjs` to ensure PostgreSQL via Compose, wait for readiness, and start production services only.
- [x] 2.5 Modify `package.json` with root `start`/service scripts while preserving `dev`, `build`, `test`, `type-check`, and `architecture`.
- [x] 2.6 Modify `apps/api/drizzle.config.ts` to read production `DATABASE_URL` for migration execution.

## Phase 3: CI/CD and Deploy

- [x] 3.1 Create `.github/workflows/ci-cd.yml` CI jobs for install, type-check, test, architecture guard, and build on PR/push.
- [x] 3.2 Add GHCR build/push steps gated to `main` using the workflow image tag and `GITHUB_TOKEN`.
- [x] 3.3 Add SSH deploy steps that log into GHCR on the VPS, pull the image on the VPS, and keep PostgreSQL in the VPS Compose service.
- [x] 3.4 Add deploy migration step using a one-off container from the newly pulled image; fail deploy on migration failure.
- [x] 3.5 Add post-deploy health checks for `/health` and `/api/health`; ensure deploy uses `pnpm start`, never `pnpm dev`.

## Phase 4: Verification and Docs

- [x] 4.1 Document required GitHub secrets and VPS `.env`/directory assumptions in `.env.example` comments or deployment docs.
- [x] 4.2 Verify `pnpm install && pnpm dev`, `docker compose up -d`, `pnpm test`, `pnpm type-check`, `pnpm architecture`, and `pnpm build`.
