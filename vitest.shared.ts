import type { UserConfig } from "vitest/config";

/**
 * Shared `test` config defaults applied across packages.
 *
 * `allowOnly: !process.env.CI` fails the run when a focused `it.only` /
 * `test.only` is left in the suite under CI, while still allowing focus
 * locally. Packages spread this into their own `test` block.
 */
export const testConfig = {
  allowOnly: !process.env.CI,
} satisfies UserConfig["test"];

export const coverageConfig = {
  provider: "v8",
  reporter: ["text", "lcov"],
  include: ["src/**/*.{ts,tsx}"],
  exclude: [
    "src/**/*.test.{ts,tsx}",
    "src/**/__tests__/**",
    "src/**/*.d.ts",
    "src/app/layout.tsx",
  ],
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 100, // Every exported function must be covered. Per-package
    lines: 80,      // overrides in vitest.config.ts for framework glue.
  },                // Pre-push hook enforces these at push time.
} satisfies NonNullable<NonNullable<UserConfig["test"]>["coverage"]>;
