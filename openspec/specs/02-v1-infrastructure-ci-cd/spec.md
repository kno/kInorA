# 02-v1-infrastructure-ci-cd Specification

## Purpose

Provide the project infrastructure — package manager, containerization, environment configuration, CI/CD pipeline, VPS deploy, and a first-run developer experience that produces a running application.

## Requirements

### Requirement: First-Run Baseline

The project MUST expose a `pnpm dev` command at root that starts all services (web, API) and serves a health endpoint returning HTTP 200.

#### Scenario: Clean install and start

- GIVEN a fresh clone with no installed dependencies
- WHEN the developer runs `pnpm install && pnpm dev`
- THEN both web and API processes start, and `GET /health` returns `{"status":"ok"}`

#### Scenario: Health endpoint on API

- GIVEN the API is running
- WHEN `GET /api/health` is called
- THEN the response MUST have HTTP status 200 and a JSON body with `status: "ok"`

### Requirement: Docker Compose for Dependencies

The project MUST provide a `docker-compose.yml` that starts PostgreSQL (and any other required services) for local development.

#### Scenario: Database available via Docker

- GIVEN no local PostgreSQL is installed
- WHEN the developer runs `docker compose up -d`
- THEN a PostgreSQL instance is available on the port defined in `.env.example`

### Requirement: CI/CD Pipeline

The project MUST include GitHub Actions workflows that run lint, type-check, unit tests, and build on every push and pull request.

#### Scenario: Pull request triggers CI

- GIVEN a PR is opened against `main`
- WHEN the CI workflow runs
- THEN it executes lint, type-check, test, and build steps, failing on any error

#### Scenario: Deploy to VPS on merge

- GIVEN a merge to `main`
- WHEN the deploy workflow triggers
- THEN it builds Docker images, pushes to registry, and deploys to the configured VPS
