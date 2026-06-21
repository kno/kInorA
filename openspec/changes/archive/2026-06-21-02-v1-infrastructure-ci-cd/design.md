# Design: V1 Infrastructure CI/CD

## Technical Approach

Add a minimal production delivery path around the existing pnpm monorepo: GitHub Actions validates every PR, builds a single GHCR image from `pnpm@10.17.1`, then deploys to the VPS over SSH on `main`. The VPS owns runtime orchestration through `pnpm start`, which delegates to Docker Compose, ensures PostgreSQL is running, runs migrations during deploy, and starts web/API with production commands only.

## Architecture Decisions

| Area | Choice | Alternatives considered | Rationale |
|------|--------|-------------------------|-----------|
| CI/CD | One workflow with CI jobs on PR/push and deploy job gated to `main` | Separate workflows | Keeps dependency caching, image metadata, and required checks in one reviewable file. |
| Registry | Push image to `ghcr.io/<owner>/<repo>` | VPS build from source | GHCR gives immutable release artifacts and faster rollback. |
| Runtime | VPS `pnpm start` runs `scripts/start-production.mjs`, which uses Compose | `pnpm dev`, manual SSH commands | Satisfies production-start requirement and removes manual deploy drift. |
| Services | One Dockerfile, Compose starts `postgres`, `api`, `web` using explicit commands | Separate Dockerfiles | Monorepo is small; one image reduces CI complexity while commands keep web/API separated. |
| Health | API registers both `/health` and `/api/health` returning `{"status":"ok"}` | Web-only health route | Spec names API health; Fastify injection tests already exist and are easiest to extend. |
| Migration | Deploy runs the migration command from a one-off container using the newly pulled application image, against the VPS PostgreSQL service, before promoting/restarting app services | Run migrations on CI runner | Migrations need VPS database/network access, must match the deployed application version, and must fail deploy before healthy release. |

## Data Flow

```text
PR/push ──→ CI: install → type-check → test → architecture → build

main merge ──→ GitHub Actions: build image → push GHCR
                                      │
                                      └─→ SSH into VPS
                                           → docker login to GHCR on VPS
                                           → docker pull new image on VPS
                                           → compose up postgres + wait
                                           → run migrations from one-off app container
                                           → pnpm start
                                           → health checks
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `.github/workflows/ci-cd.yml` | Create | CI checks plus main deploy, GHCR push, SSH release, health verification. |
| `Dockerfile` | Create | Node 24/pnpm 10.17.1 monorepo image installing/building web, API, domain, contracts. |
| `docker-compose.yml` | Create | `postgres`, `api`, and `web` services, health checks, named volume, GHCR image interpolation. |
| `.env.example` | Create | `DATABASE_URL`, Postgres credentials, app ports, GHCR image/tag placeholders. |
| `package.json` | Modify | Add root `start`, likely `start:services`, and keep existing `dev/build/test` behavior. |
| `scripts/start-production.mjs` | Create | Starts/checks PostgreSQL via Compose, waits for readiness, starts production services. |
| `apps/api/src/routes/health.ts` | Modify | Register `/health` and `/api/health`; align response with spec. |
| `apps/api/src/routes/__tests__/health.test.ts` | Modify | Add `/api/health` and exact JSON contract coverage. |
| `apps/api/drizzle.config.ts` | Modify | Read `DATABASE_URL` from environment for production migrations. |

## Interfaces / Contracts

Health contract for both API routes:

```json
{"status":"ok"}
```

Required secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, optional `VPS_PORT`, and production `.env` values already present on the VPS. Use GitHub `GITHUB_TOKEN` for GHCR unless cross-repo permissions require a PAT.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Health route contracts and production startup command composition | Vitest Fastify injection; script command helpers extracted for testability if needed. |
| Integration | Compose PostgreSQL readiness and migration command | Manual/local `docker compose up -d postgres` plus deploy dry-run command documented in tasks. |
| CI | Install, type-check, tests, architecture, build | GitHub Actions runs `pnpm install --frozen-lockfile`, `pnpm type-check`, `pnpm test`, `pnpm architecture`, `pnpm build`. |

## Migration / Rollout

No data migration file is required by this design. Rollout is image-based: GitHub Actions builds and pushes the new GHCR tag, then the SSH deploy step logs into GHCR from the VPS, pulls the image on the VPS, runs Drizzle migrations from a one-off container using that image against the VPS PostgreSQL service, starts production, and verifies `/health` plus `/api/health`. The image contains the migration code for the deployed application version; PostgreSQL data remains in the VPS Compose volume/service, not inside the image. On failure, keep existing containers running when possible; rollback by setting the previous GHCR tag and rerunning `pnpm start`. Migration rollback requires DB backup/forward fix.

## Open Questions

- [ ] Exact VPS deployment directory and reverse-proxy/public ports must be supplied during implementation.
- [ ] Workload risk: likely above 400 changed lines if CI, Docker, scripts, env docs, and tests land in one PR; task planning should recommend chained PR slices.
