import { defineConfig } from "vitest/config";
import { coverageConfig, resolveConfig, ssrResolveConfig } from "../../vitest.shared";
import { assertCoverageContext, functionsThreshold } from "./coverage-mode.mjs";

// Fails the run outright if CI ever measures this package's coverage without a
// database. See coverage-mode.mjs — the two-floor design cannot catch that one
// regression by itself, so it is asserted rather than inferred from a number.
assertCoverageContext();

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
        // TWO floors, on purpose, because there are two honest measurements —
        // and this file no longer picks between them. See coverage-mode.mjs for
        // the numbers and the reasoning; the short version:
        //
        //   93  integrated — DATABASE_URL present, integration suites executing
        //       (measured 94.35% on main 78ce941, CI run 31352490931).
        //   90  hermetic — no database, every
        //       `describe.skipIf(!process.env.DATABASE_URL)` suite skipping
        //       (measured 91.51% on the same commit).
        //
        // Until #425 there was a single floor pinned to the LOWER measurement,
        // because `.githooks/pre-push` ran `pnpm test:coverage` with no
        // database: anything above 91.51% blocked `git push` for every
        // developer without a local Postgres, and the hook's remedy for that
        // was `git push --no-verify` — the habit this gate exists to prevent.
        // The hook is now mode-aware too (scripts/prepush-coverage.mjs), so the
        // three points CI genuinely proves are finally enforced in CI without
        // holding a local push to infrastructure the developer may not have.
        //
        // The dual standard is stated rather than hidden: the hook prints which
        // mode it selected and which floor that buys before it runs anything.
        //
        // Note the coverage number is not what protects the database wiring: if
        // Postgres is unreachable the "Run database migrations" step fails and
        // the job goes red before coverage is measured at all. The case a
        // number cannot catch — DATABASE_URL dropped from the Coverage step
        // alone — is handled by `assertCoverageContext()` above.
        //
        // Close real gaps, never lower these. The genuine remaining holes are
        // `billing-admin.ts` (66.66% functions) and `tier-override-admin.ts`
        // (80%) — both measured WITH a database, so they are real gaps rather
        // than the measurement artefact #404 was about.
        //
        // Historical note, still true: V8 only registers a closure as coverable
        // once its declaration site executes, which is why this number dropped
        // from an apparent 88.83% to 85.40% when `build-app.test.ts` began
        // invoking the real `buildApp()` (#369).
        functions: functionsThreshold(),
      },
    },
  },
});
