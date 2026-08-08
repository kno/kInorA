#!/usr/bin/env node
/**
 * CI guard for the integration-suite job (issue #382).
 *
 * The job it guards can go green in two different ways without having verified
 * anything, and this script fails the job for both.
 *
 * 1. DRIFT — a suite exists on disk but was never invoked. The job used to name
 *    every integration file explicitly, and eight of eighteen suites had fallen
 *    outside that list: they ran in no CI job at all, and their assertions only
 *    ever executed on a contributor's machine. The step now globs the directory,
 *    and this guard cross-checks the files vitest actually reported against the
 *    files present on disk. A count-based floor cannot catch this class of
 *    failure — a suite that is never invoked contributes nothing to any count.
 *
 * 2. NO DATABASE — every suite pairs `describe.skipIf(!hasDb)` (the real tests)
 *    with a `describe.skipIf(hasDb)` placeholder that passes trivially when
 *    DATABASE_URL is absent. If the variable is dropped/renamed or the Postgres
 *    service is unreachable, vitest runs ONLY the placeholders, exits 0, and the
 *    job goes green having verified none of the invariants. Every suite appears
 *    in the report in that case, so the drift check alone would pass.
 *
 * The floor for (2) is derived from the file count rather than pinned to a
 * literal: a DB-absent run yields exactly one passing placeholder per file, so
 * requiring strictly more than `2 x fileCount` passing tests separates a
 * placeholder-only run from a real one without ever needing a manual bump when
 * suites are added. A pinned total would turn every added test into a spurious
 * red; a pinned floor silently rots.
 *
 * Usage: node assert-integration-suites-executed.mjs <report.json> <suites-dir>
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const SUITE_SUFFIX = ".integration.test.ts";
/** Minimum passing tests per suite file for the run to be considered real. */
const MIN_PASSED_PER_SUITE = 2;

const [reportPath, suitesDir] = process.argv.slice(2);

if (!reportPath || !suitesDir) {
  console.error(
    "ERROR: usage: assert-integration-suites-executed.mjs <report.json> <suites-dir>",
  );
  process.exit(1);
}

/** @type {{ numPassedTests?: number, testResults?: Array<{ name: string }> }} */
const report = JSON.parse(readFileSync(reportPath, "utf8"));

const suitesOnDisk = readdirSync(resolve(suitesDir))
  .filter((file) => file.endsWith(SUITE_SUFFIX))
  .sort();

if (suitesOnDisk.length === 0) {
  console.error(
    `ERROR: no *${SUITE_SUFFIX} files found in ${suitesDir}. The glob in the run step ` +
      "matched nothing, so this job verified nothing. Failing the job.",
  );
  process.exit(1);
}

const executedSuites = new Set(
  (report.testResults ?? []).map((result) => basename(result.name)),
);
const unexecuted = suitesOnDisk.filter((suite) => !executedSuites.has(suite));

if (unexecuted.length > 0) {
  console.error(
    "ERROR: integration suites exist on disk but were never invoked by this job:\n" +
      unexecuted.map((suite) => `  - ${suite}`).join("\n") +
      "\nTheir assertions ran nowhere in CI. Failing the job.",
  );
  process.exit(1);
}

const passed = report.numPassedTests ?? 0;
const floor = suitesOnDisk.length * MIN_PASSED_PER_SUITE;

if (passed < floor) {
  console.error(
    `ERROR: integration suites did NOT execute against a real database ` +
      `(numPassedTests=${passed} < ${floor} for ${suitesOnDisk.length} suites). ` +
      "DATABASE_URL was likely unset or unreachable, so vitest ran only the " +
      "skip-placeholder tests and would have gone GREEN without verifying any " +
      "invariant. Failing the job.",
  );
  process.exit(1);
}

console.log(
  `OK: all ${suitesOnDisk.length} integration suites executed (${passed} passed tests).`,
);
