# 03-v1-quality-tdd Specification

## Purpose

Enforce strict TDD across the codebase using a RED-GREEN-Triangle edge-case loop, covering all test layers: unit, integration, and e2e.

## Requirements

### Requirement: RED-GREEN-Triangle Loop

Every feature implementation MUST follow: write a failing test (RED), make it pass with minimal code (GREEN), then add edge-case tests and verify they fail before passing (Triangle).

#### Scenario: RED step enforced

- GIVEN no test exists for a new module
- WHEN development begins
- THEN the first commit MUST contain a failing test

#### Scenario: Triangle edge cases added

- GIVEN a passing implementation for the happy path
- WHEN the developer adds edge-case tests (empty, error, boundary, offline)
- THEN each edge-case test MUST initially fail and then be made to pass

### Requirement: Test Coverage Threshold

Code coverage MUST be at least 80% across all packages. New code MUST meet or exceed this threshold.

#### Scenario: Coverage below threshold fails CI

- GIVEN a PR with coverage at 75%
- WHEN the CI coverage step runs
- THEN the CI step fails and blocks the merge

#### Scenario: Coverage threshold met

- GIVEN a PR with coverage at 85%
- WHEN the CI coverage step runs
- THEN the step passes

### Requirement: Test Stack

The project MUST include vitest for unit/integration tests and Playwright for e2e tests.

#### Scenario: Unit test runs

- GIVEN a test file using vitest with `describe`/`it` blocks
- WHEN `pnpm --filter <workspace> test` runs
- THEN vitest executes and reports pass/fail per test

#### Scenario: E2E test runs

- GIVEN a Playwright spec file
- WHEN `pnpm test:e2e` runs
- THEN the spec opens a browser, interacts with the app, and asserts outcomes
