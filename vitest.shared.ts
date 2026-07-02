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

/**
 * Shared Vite `resolve` config. The custom "source" export condition lets
 * Vite/vitest resolve @kinora workspace packages to their TypeScript source
 * (via each package's "source" export condition) without a prebuilt dist.
 * Turbopack (next dev) and the production build do NOT activate "source" and
 * correctly fall through to the "default" dist entry. Every workspace vitest
 * project must spread this into its top-level `resolve` so runtime value
 * imports from workspace packages resolve in tests with no dist present.
 */
export const resolveConfig = {
  conditions: ["source"],
} satisfies UserConfig["resolve"];

/**
 * Mirrors `resolveConfig` for Vite's SSR resolution pipeline. Vitest's Node
 * environment (used by apps/api) resolves externalized/CJS-adjacent
 * dependencies (e.g. langchain packages) through `ssr.resolve`, which does
 * NOT inherit the top-level `resolve.conditions`. Without this, any module
 * that imports a workspace package alongside one of those externalized deps
 * falls back to the "default" (dist) condition and fails when no dist is
 * built. Every workspace vitest project must spread this into its top-level
 * `ssr.resolve` alongside `resolveConfig` in `resolve`.
 */
export const ssrResolveConfig = {
  conditions: ["source"],
} satisfies NonNullable<UserConfig["ssr"]>["resolve"];

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
