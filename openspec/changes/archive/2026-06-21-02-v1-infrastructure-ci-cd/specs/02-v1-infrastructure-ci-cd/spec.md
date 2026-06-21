# Delta for 02-v1-infrastructure-ci-cd

## MODIFIED Requirements

### Requirement: First-Run Baseline

The project MUST provide a root first-run developer flow using the pinned package manager from `package.json`. `pnpm dev` MUST start local web/API services, and the running system MUST expose both `GET /health` and `GET /api/health` with HTTP 200 JSON health responses.
(Previously: only required `pnpm dev` and health coverage without package-manager pin clarity or both route contracts.)

#### Scenario: Clean install and start

- GIVEN a fresh clone with no installed dependencies
- WHEN the developer runs `pnpm install && pnpm dev`
- THEN web and API processes start successfully
- AND `GET /health` returns HTTP 200 with `{"status":"ok"}`

#### Scenario: Health endpoint on API

- GIVEN the API is running
- WHEN `GET /api/health` is called
- THEN the response MUST have HTTP 200 and JSON body `{"status":"ok"}`

#### Scenario: Missing dependency state

- GIVEN dependencies are not installed or required environment values are missing
- WHEN the developer attempts first-run startup
- THEN the startup path MUST fail with actionable setup guidance instead of silent failure

### Requirement: Docker Compose for Dependencies

The project MUST provide Docker Compose dependency orchestration for local development. Compose MUST start PostgreSQL using values documented in `.env.example`, and the application MUST be able to connect to that PostgreSQL service during first-run development.
(Previously: required Docker Compose PostgreSQL only at a high level.)

#### Scenario: Database available via Docker

- GIVEN no local PostgreSQL is installed
- WHEN the developer runs `docker compose up -d`
- THEN PostgreSQL is available on the port defined in `.env.example`
- AND the app can connect using the documented database URL

#### Scenario: PostgreSQL already running

- GIVEN the Compose PostgreSQL service is already running
- WHEN the developer repeats `docker compose up -d`
- THEN the command MUST be idempotent and leave PostgreSQL available

#### Scenario: Database unavailable

- GIVEN PostgreSQL cannot start or cannot be reached
- WHEN the app starts in development
- THEN the failure MUST identify the database dependency as unavailable

### Requirement: CI/CD Pipeline

The project MUST include GitHub Actions workflows that run install, type-check, tests, architecture guard, and build on push and pull request. On merge to `main`, deployment MUST be automatic and complete: build the production image, push it to `ghcr.io`, SSH to the VPS, run database migrations on the VPS, and start production with `pnpm start`. The VPS MUST NOT use `pnpm dev`; `pnpm start` MUST verify PostgreSQL is running or start it before serving traffic.
(Previously: CI/CD required generic lint/type-check/test/build and deploy without GHCR, migration, production start, or PostgreSQL startup guarantees.)

#### Scenario: Pull request triggers CI

- GIVEN a PR is opened against `main`
- WHEN the CI workflow runs
- THEN it executes install, type-check, test, architecture guard, and build steps
- AND it fails the check when any required step fails

#### Scenario: Deploy to VPS on merge

- GIVEN a merge to `main`
- WHEN the deploy workflow triggers
- THEN it builds the production image, pushes it to `ghcr.io`, and deploys to the configured VPS
- AND the deploy completes without manual VPS commands

#### Scenario: Migrations run during deploy

- GIVEN the deploy workflow is connected to the VPS
- WHEN deployment starts the release
- THEN database migrations MUST run on the VPS before the new service is considered healthy
- AND migration failure MUST fail the deployment

#### Scenario: Production startup command

- GIVEN the VPS is starting or restarting the application
- WHEN the production service starts
- THEN it MUST use `pnpm start` and MUST NOT use `pnpm dev`
- AND startup MUST verify PostgreSQL is running or start it before serving traffic
