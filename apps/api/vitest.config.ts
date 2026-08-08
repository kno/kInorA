import { defineConfig } from "vitest/config";
import { coverageConfig, resolveConfig, ssrResolveConfig } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    ...resolveConfig,
  },
  ssr: {
    resolve: {
      ...ssrResolveConfig,
    },
  },
  test: {
    globals: true,
    coverage: {
      ...coverageConfig,
      exclude: [
        ...coverageConfig.exclude,
        "src/index.ts",
        "src/db/client.ts",
        // Shared test-only mocks/helpers — infrastructure, not product code.
        "src/test-support/**",
        // Declarative Drizzle schema: tables/columns plus lazy `.references(() => …)`
        // callbacks that Drizzle only invokes at query/migration build time, not in
        // unit tests. Shape is asserted in src/db/__tests__/*-schema.test.ts and the
        // migration is applied/verified in E2E — coverage here measures nothing real.
        "src/db/schema.ts",
      ],
      thresholds: {
        ...coverageConfig.thresholds,
        // Some helpers need E2E reach; current is 85.40%. That figure dropped
        // from an apparent 88.83% when `src/__tests__/build-app.test.ts` began
        // invoking the real `buildApp()` (#369): V8 only registers a closure as
        // coverable once its declaration site executes, so the composition
        // root's ~50 inline route-option closures were previously invisible to
        // the instrumenter rather than covered. The lower number is the honest
        // one. Headroom is thin — close real gaps, never lower this.
        functions: 85,
      },
    },
  },
});
