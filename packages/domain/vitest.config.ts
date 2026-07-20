import { defineConfig } from "vitest/config";
import { coverageConfig, resolveConfig, ssrResolveConfig } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    ...resolveConfig,
  },
  // Node-env vitest resolves workspace packages through ssr.resolve, which does
  // NOT inherit resolve.conditions; without this a runtime value import from a
  // workspace package (e.g. MUSCLE_GROUPS from @kinora/contracts in
  // progress/distribution.ts) falls back to the "default" dist entry and fails
  // in CI where no dist is built. Mirrors apps/api's config.
  ssr: {
    resolve: {
      ...ssrResolveConfig,
    },
  },
  test: {
    globals: true,
    coverage: coverageConfig,
  },
});
