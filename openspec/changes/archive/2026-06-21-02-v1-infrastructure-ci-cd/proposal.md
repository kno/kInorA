# Proposal: V1 Infrastructure CI/CD

## Intent

Make the v1 roadmap infrastructure slice deployable and operable: automated CI, Dockerized production delivery, GHCR image publishing, VPS deployment on merge to `main`, migrations, and health checks. This turns README roadmap item `02-v1-infrastructure-ci-cd` into a reliable release path without using development servers in production.

## Scope

### In Scope
- GitHub Actions CI for install, type-check, tests, architecture guard, and build.
- Docker/Compose infrastructure for app runtime and PostgreSQL dependency management.
- Automatic deploy on merge to `main`: build image, push to `ghcr.io`, SSH to VPS, run migrations, and start with `pnpm start`.
- Production health coverage for `GET /health` and `GET /api/health`.

### Out of Scope
- Changing package manager version beyond `packageManager: pnpm@10.17.1`.
- Implementing product features outside infrastructure, deployment, and health checks.
- Creating design/tasks or implementation in this phase.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `02-v1-infrastructure-ci-cd`: refine CI/CD, Docker, health, VPS startup, registry, and migration requirements.

## Approach

Add an active OpenSpec change over the existing infrastructure spec. The implementation should later define CI workflows, Docker assets, production start scripts, health routes, and deploy automation while preserving strict TDD and current monorepo boundaries.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `.github/workflows/` | New | CI and main-branch deploy workflows. |
| `Dockerfile`, `docker-compose.yml` | New | Production image and service orchestration. |
| `package.json`, workspace scripts | Modified | `pnpm start` production startup; no VPS `pnpm dev`. |
| `apps/api`, `apps/web` | Modified | Health endpoints and production runtime integration. |
| `apps/api` migrations | Modified | Deploy pipeline runs DB migrations on VPS. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| VPS deploy leaves service unavailable | Med | Health checks, restart strategy, and rollback to previous image. |
| Migration failure during deploy | Med | Run migrations before traffic switch/restart and fail deploy on error. |
| README and package manager mismatch | Low | Use `package.json` pin unless a separate upgrade decision is made. |

## Rollback Plan

Revert workflow/Docker/start-script changes, redeploy the previous GHCR image tag on the VPS, and restore the prior database state from backup if a migration was applied and cannot be forward-fixed.

## Dependencies

- GitHub Actions secrets for GHCR and VPS SSH.
- VPS with Docker, PostgreSQL access, production `.env`, and migration permissions.

## Success Criteria

- [ ] PRs and pushes run CI successfully.
- [ ] Merge to `main` deploys automatically and completes without manual VPS commands.
- [ ] VPS runtime uses `pnpm start`, never `pnpm dev`.
- [ ] Deploy runs migrations and serves both health endpoints with HTTP 200.
