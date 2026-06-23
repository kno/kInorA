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
    coverage: {
      ...coverageConfig,
      exclude: [
        ...coverageConfig.exclude,
        // Framework glue — the pure logic in auth-gate.ts (100%) and
        // proxy.ts (82.5%) is tested directly. middleware.ts, route.ts,
        // and actions.ts are thin Next.js wrappers that Vitest cannot
        // instrument (they depend on next/server, next/headers, etc.).
        "src/middleware.ts",
        "src/app/auth/social/login/route.ts",
        "src/**/actions.ts",
      ],
    },
  },
});
