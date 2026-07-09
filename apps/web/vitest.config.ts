import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import {
  coverageConfig,
  resolveConfig,
  ssrResolveConfig,
  testConfig,
} from "../../vitest.shared";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    // "source" condition resolution comes from the shared resolveConfig —
    // see vitest.shared.ts for the full explanation.
    ...resolveConfig,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only always throws at runtime — stub it out in the test
      // environment so modules that import it can be exercised via
      // vi.importActual without the module throwing.
      "server-only": fileURLToPath(
        new URL("./test/__mocks__/server-only.ts", import.meta.url)
      ),
    },
  },
  // Server modules (e.g. src/i18n/request.ts imports next/headers) resolve
  // through Vitest's SSR pipeline, which does NOT inherit the top-level
  // resolve.conditions. Without this, runtime value imports from @kinora/*
  // workspace packages fall back to the "default" (dist) export and fail when
  // no dist is built. Mirrors apps/api — see vitest.shared.ts.
  ssr: {
    resolve: {
      ...ssrResolveConfig,
    },
  },
  test: {
    ...testConfig,
    globals: true,
    coverage: {
      ...coverageConfig,
      exclude: [
        ...coverageConfig.exclude,
        // Framework glue — the pure logic in auth-gate.ts (100%) and
        // proxy.ts (82.5%) is tested directly. proxy.ts, route.ts, and
        // actions.ts are thin Next.js wrappers that Vitest cannot
        // instrument (they depend on next/server, next/headers, etc.).
        "src/proxy.ts",
        "src/app/auth/social/login/route.ts",
        "src/**/actions.ts",
      ],
      thresholds: {
        ...coverageConfig.thresholds,
        functions: 90, // Framework excl. limits max; current is 94.44%.
      },
    },
  },
});
