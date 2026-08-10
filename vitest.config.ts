import { defineConfig } from "vitest/config";

import { resolveConfig, testConfig } from "./vitest.shared";

/**
 * Root vitest project for `scripts/` (issue #437).
 *
 * `pnpm test` is `pnpm -r test`, which visits `apps/*` and `packages/*` only,
 * and every package `include` resolves against that package's own root. The
 * repository-root `scripts/` directory belongs to no package, so its suites
 * were reachable from no project and had never executed — 37KB of assertions
 * that could not fail. This project is what makes them run.
 *
 * `scripts/` is deliberately NOT turned into a pnpm workspace package: it holds
 * repository tooling, not a shipped library, and enrolling it would pull it
 * into `pnpm -r build`, `pnpm -r type-check` and every other recursive gate for
 * no benefit. A root project keeps the wiring where the code actually lives.
 *
 * The suites here are pure: they import helpers from the tooling modules and
 * read checked-in files. Nothing starts Docker or touches a database, so this
 * project adds no infrastructure requirement to CI.
 */
export default defineConfig({
  resolve: {
    ...resolveConfig,
  },
  test: {
    ...testConfig,
    include: ["scripts/__tests__/**/*.test.ts"],
  },
});
