import { defineConfig } from "vitest/config";
import { coverageConfig, resolveConfig } from "../../vitest.shared";

export default defineConfig({
  resolve: {
    ...resolveConfig,
  },
  test: {
    globals: true,
    coverage: coverageConfig,
  },
});
