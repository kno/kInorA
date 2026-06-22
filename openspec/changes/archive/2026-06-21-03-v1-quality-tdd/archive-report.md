# Archive Report: 03-v1-quality-tdd

## Summary

The quality/TDD baseline can now be closed with enforceable coverage and app-backed e2e gates. The root workspace includes a coverage command that fails below 80% thresholds, CI runs the coverage and Playwright gates, and `pnpm test:e2e` starts the web app before asserting deterministic homepage behavior in Chromium.

## Implemented

- Added `@playwright/test` as a root development dependency.
- Added the root `test:e2e` script that runs `playwright test`.
- Added `playwright.config.ts` with a Chromium-only baseline, `tests/e2e` as the conventional e2e test directory, and a web server that starts the Next.js web app for e2e runs.
- Added `tests/e2e/browser-smoke.spec.ts` to prove the e2e runner can launch a browser, open the app homepage, and assert stable browser-visible outcomes.
- Added shared Vitest coverage configuration with global 80% thresholds for statements, branches, functions, and lines, with package-local exclusions for runtime entrypoints that are not unit-test targets.
- Added workspace/package coverage scripts and wired CI to run `pnpm test:coverage`.
- Added `packages/contracts` Vitest scripts/config and a lightweight contract-boundary test. The package currently exports TypeScript-only contracts, so the test asserts the intentional absence of runtime exports and locks the shared DTO/type boundary with Vitest type assertions. Its type-only `src/index.ts` is explicitly excluded from V8 coverage because TypeScript erases those contracts before runtime instrumentation.
- Wired CI to install the Chromium Playwright browser and run `pnpm test:e2e`, making Playwright `forbidOnly` meaningful in CI.

## Verification

- `pnpm install` completed successfully and updated workspace dependencies from the lockfile.
- `pnpm type-check` passed across the workspace.
- `pnpm test:coverage` passed: all four non-root package/app workspaces now participate in the recursive coverage run. The root workspace is the command orchestrator and has no source coverage target. Runtime-bearing packages met or exceeded the 80% global coverage thresholds, and `packages/contracts` is covered by an honest type-boundary test for its type-only exports.
- `pnpm test:e2e` passed: Playwright started the web app and 1 Chromium homepage smoke test passed.

## Caveats

This archive closes the quality/TDD baseline with a minimal app-backed e2e test. The contracts package is type-only today, so coverage is enforced through participation in `pnpm test`/`pnpm test:coverage` plus type-boundary tests rather than runtime statement percentages. Future product changes should add flow-specific e2e coverage and runtime contract tests if `packages/contracts` starts exporting executable validators or constants.
