import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.shared";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      ...coverageConfig,
      exclude: [...coverageConfig.exclude, "src/index.ts", "src/db/client.ts"],
      thresholds: {
        ...coverageConfig.thresholds,
        functions: 85, // Some helpers need E2E reach; current is 86.84%.
      },
    },
  },
});
