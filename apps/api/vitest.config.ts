import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.shared";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      ...coverageConfig,
      exclude: [...coverageConfig.exclude, "src/index.ts", "src/db/client.ts"],
    },
  },
});
