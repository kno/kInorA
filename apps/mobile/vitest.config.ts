import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolveConfig, ssrResolveConfig } from "../../vitest.shared";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    // "source" condition resolution comes from the shared resolveConfig —
    // see vitest.shared.ts for the full explanation. Mobile is the FIRST
    // consumer of @kinora/i18n outside web/api; without this, importing
    // @kinora/i18n's runtime value exports (flattenMessages, mergeWithBase,
    // catalogs) here falls back to its "default" (dist) export and fails
    // when no dist is built.
    ...resolveConfig,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Vitest always executes test files through Vite's SSR module runner (no
  // "client" bundling step exists in Vitest), so the top-level
  // resolve.conditions above is NOT inherited here — mirrors apps/web and
  // apps/api, see vitest.shared.ts. Without this, @kinora/i18n's "." export
  // falls back to its "default" (dist) condition and fails with no dist
  // built, even though the top-level `resolve` above is configured.
  ssr: {
    resolve: {
      ...ssrResolveConfig,
    },
  },
  test: {
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
