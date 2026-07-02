import { defineConfig } from "vitest/config";
import { coverageConfig, resolveConfig } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    ...resolveConfig,
  },
  test: {
    globals: true,
    coverage: {
      ...coverageConfig,
      // This package currently exports TypeScript-only contracts. V8 cannot
      // measure erased types as runtime coverage, so the boundary is verified
      // with Vitest type assertions instead of a misleading 0% file report.
      exclude: [...coverageConfig.exclude, "src/index.ts"],
    },
  },
});
