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
        // Raised 85 → 90 after #404 made the coverage run execute the
        // integration suites instead of skipping them.
        //
        // Two different numbers are now in play, and this floor is deliberately
        // derived from the LOWER one:
        //
        //   94.35%  CI, with DATABASE_URL and a real Postgres (run 31326626023,
        //           2471 tests pass, 121 that used to skip now execute).
        //   91.51%  hermetic, no database — every
        //           `describe.skipIf(!process.env.DATABASE_URL)` suite skips.
        //
        // The floor CANNOT be set from the 94.35% figure. `.githooks/pre-push`
        // runs `pnpm test:coverage` with no database, so any value above 91.51%
        // blocks `git push` for every developer who does not happen to have
        // Postgres running — and that hook's failure message advertises
        // `git push --no-verify`, which is the habit this gate exists to
        // prevent. Verified, not assumed: at 92 the hermetic run exits 1 with
        // "Coverage for functions (91.51%) does not meet global threshold".
        //
        // So 90 is bounded above by the hermetic ceiling (1.5 points of churn
        // headroom against 91.51), not chosen from what CI happened to report.
        // Closing the remaining CI headroom means making the pre-push hook
        // database-aware first; until then this floor is what BOTH contexts can
        // honestly hold.
        //
        // Note the coverage number is not what protects the database wiring: if
        // Postgres is unreachable the "Run database migrations" step fails and
        // the job goes red before coverage is measured at all.
        //
        // Close real gaps, never lower this. The genuine remaining holes are
        // `billing-admin.ts` (66.66% functions) and `tier-override-admin.ts`
        // (80%) — both measured WITH a database, so they are real gaps rather
        // than the measurement artefact #404 was about.
        //
        // Historical note, still true: V8 only registers a closure as coverable
        // once its declaration site executes, which is why this number dropped
        // from an apparent 88.83% to 85.40% when `build-app.test.ts` began
        // invoking the real `buildApp()` (#369).
        functions: 90,
      },
    },
  },
});
