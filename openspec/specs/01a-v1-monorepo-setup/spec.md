# 01a-v1-monorepo-setup Specification

## Purpose

Bootstrap a runnable pnpm monorepo with web, API, shared packages, and root commands from the first implementation slice.

## Requirements

### Requirement: Workspace Layout

The project MUST use pnpm workspaces with `apps/web`, `apps/api`, and shared `packages/*` workspaces.

#### Scenario: Fresh install resolves workspaces

- GIVEN a fresh clone
- WHEN `pnpm install` runs at the root
- THEN all declared workspaces resolve without dependency errors

### Requirement: Runnable Development Baseline

The project MUST expose a root `pnpm dev` command that starts the web and API baselines without product features.

#### Scenario: First development start

- GIVEN dependencies are installed
- WHEN the developer runs `pnpm dev`
- THEN the web and API processes start successfully
- AND a health route is reachable with HTTP 200

### Requirement: Shared Package Resolution

The system MUST allow apps to import shared contracts through stable package aliases.

#### Scenario: App imports shared contract

- GIVEN `packages/contracts` exports a shared type
- WHEN `apps/api` imports it through `@kinora/contracts`
- THEN the build resolves the import successfully
