import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { coverageConfig } from "../../vitest.shared";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    coverage: coverageConfig,
  },
});
