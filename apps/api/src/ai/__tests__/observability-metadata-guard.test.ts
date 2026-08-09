/**
 * Guard test for body-metric leakage into observability metadata
 * (17c-profile-body-metrics, PR 3 — see design.md "The observability
 * discipline requirement").
 *
 * The Langfuse `mask` hook (`trace-redaction.ts`) covers trace `input`/
 * `output` ONLY, never `metadata`. `PlanTraceMetadata` closes the two
 * generation trace-metadata literals by TYPE (a real guarantee), but
 * `ObservabilityMetadata` (`event-logger.ts`) is a flat scalar bag that
 * cannot be narrowed generically without retyping every caller. This guard
 * is the second, honestly-graded control: a source-text scan over
 * `apps/api/src/**\/*.ts` that fails if any `metadata:` object-literal key
 * looks like a body-metric value.
 *
 * Stated plainly, in the family of `migration-journal.test.ts`: this is a
 * LINT, not a type. It catches the plausible mistake — `metadata: { weightKg }`
 * accidentally added to an existing `logEvent`/`recordEvent` call — and it
 * will NOT catch a determined rename (e.g. `bw` instead of `weightKg`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "..");

/** Files the guard never scans — the redaction module and its own tests are
 * ALLOWED to mention these terms (they name the exact keys being protected). */
const EXEMPT_BASENAMES = new Set([
  "trace-redaction.ts",
  "trace-redaction.test.ts",
  "trace-metadata.ts",
  "trace-metadata.test.ts",
  "observability-metadata-guard.test.ts",
]);

/** A key matching this shape inside a `metadata:` object literal is a body-metric value. */
const BODY_METRIC_KEY_PATTERN = /^(weightKg|heightCm|selfDescribedSex|bodyweight)/i;

/**
 * Timeout for the source-tree scan below (#423).
 *
 * This guard walks `apps/api/src` and brace-scans every `metadata:` literal in
 * it. Measured on this tree:
 *
 * | condition                        | duration |
 * |----------------------------------|----------|
 * | standalone                       | 49–92ms  |
 * | under the parallel coverage run  | 474–1454ms (two identical runs) |
 *
 * Standalone it is nowhere near 5s, so unlike its sibling in `packages/domain`
 * this one has not been observed failing. What it HAS shown is the same
 * sensitivity: a 15x spread between the quiet case and `pnpm -r --if-present
 * test:coverage`, from page-cache misses and CPU contention rather than from
 * any work it does. 1454ms under load with a 5s ceiling is a 3.4x margin, and
 * the margin narrows every time a package or a source file is added.
 *
 * Raised to the same 30s for the same reason and stated honestly: this is
 * pre-emptive, sized from measurement rather than from a failure. A scan of
 * one app's `src` that takes 30s is a real signal; one that takes 1.5s on a
 * busy machine is not.
 */
const SCAN_TIMEOUT_MS = 30_000;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name.endsWith(".ts") && !EXEMPT_BASENAMES.has(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Finds every `metadata: { … }` object-literal source span in `source` and
 * returns the raw text between the literal's braces. A simple brace-depth
 * scan (not a full parser) is proportionate for a lint over TypeScript
 * source that never nests unrelated braces inside a string on the same
 * line as `metadata:` — the same trade-off `migration-journal.test.ts`
 * makes by reading structured files directly rather than parsing.
 */
function metadataLiteralBodies(source: string): string[] {
  const bodies: string[] = [];
  const marker = /metadata\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    bodies.push(source.slice(start, i - 1));
  }
  return bodies;
}

describe("observability metadata guard — no body-metric key in a metadata: literal", () => {
  // The timeout is on THIS test only. The no-op check below operates on a
  // string literal with no I/O and stays at the default 5s, as does every
  // other test in the package.
  it("scans every apps/api/src/**/*.ts file and finds no body-metric-shaped metadata key", { timeout: SCAN_TIMEOUT_MS }, () => {
    const offenders: { file: string; body: string }[] = [];

    for (const file of walk(srcDir)) {
      const source = readFileSync(file, "utf-8");
      for (const body of metadataLiteralBodies(source)) {
        // Match bare identifier keys (`weightKg`, `weightKg:`, shorthand `weightKg,`)
        // and quoted keys ("weightKg":) — both are valid object-literal key forms.
        const keyMatches = body.match(/(?:['"]?)([A-Za-z_$][A-Za-z0-9_$]*)(?:['"]?)\s*[,:}]/g) ?? [];
        for (const raw of keyMatches) {
          const key = raw.replace(/['":,}]/g, "").trim();
          if (key && BODY_METRIC_KEY_PATTERN.test(key)) {
            offenders.push({ file, body });
          }
        }
      }
    }

    expect(
      offenders,
      `body-metric-shaped key found in a metadata: literal: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("the pattern itself would catch a deliberately introduced offender (guard is not a no-op)", () => {
    const sample = `this.observability?.recordEvent({ metadata: { planId, weightKg: 68 } });`;
    const bodies = metadataLiteralBodies(sample);
    expect(bodies.length).toBeGreaterThan(0);
    const found = bodies.some((body) =>
      (body.match(/(?:['"]?)([A-Za-z_$][A-Za-z0-9_$]*)(?:['"]?)\s*[,:}]/g) ?? []).some((raw) =>
        BODY_METRIC_KEY_PATTERN.test(raw.replace(/['":,}]/g, "").trim()),
      ),
    );
    expect(found).toBe(true);
  });
});
