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
        // Type-only modules. The first seven declare nothing but `interface` /
        // `type`, which TypeScript erases entirely — each compiles to a bare
        // `export {}`. The last two are re-export boundaries that exist solely
        // to satisfy the `no-root-barrel-import` subpath guard
        // (packages/domain/src/progress/__tests__/no-root-barrel-import.test.ts);
        // each emits a single
        // `export … from "@kinora/domain/progress"` and declares no symbol of
        // its own — the re-exported functions are covered in `@kinora/domain`.
        // Verified against the `tsc` output in `dist/`, not by filename: a
        // `-port.ts` suffix is NOT evidence a module is type-only. Two files
        // that look like they belong here and deliberately do NOT:
        // `src/ai/embedding-port.ts` (retry classification, error
        // classification and timeout logic) and `src/ai/prompt-source-port.ts`
        // (declares the `PromptNotFoundError` class). Excluding either would
        // hide real untested behaviour behind a naming convention.
        "src/ai/port.ts",
        "src/ai/extraction-port.ts",
        "src/ai/speech-synthesizer-port.ts",
        "src/ai/speech-transcriber-port.ts",
        "src/ai/trace-metadata.ts",
        "src/billing/types.ts",
        "src/storage/object-storage-port.ts",
        "src/db/muscle-classifier.ts",
        "src/db/progress-domain.ts",
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
