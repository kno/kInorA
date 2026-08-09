import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard test (09c-v1-progress-dashboard-stats, Slice 1a, task 1a.5).
 *
 * `@kinora/domain/progress` MUST stay a self-contained subpath: it must
 * never be re-exported through the root `@kinora/domain` barrel, and no
 * consumer file may import both `@kinora/domain/progress` and the bare
 * `@kinora/domain` root specifier. The root barrel re-exports
 * `auth/password` (scrypt → `node:crypto`), which breaks the Next.js web
 * build if pulled in transitively — see design.md "Where the aggregation
 * code lives, and why the subpath matters".
 *
 * This test scans the actual repository tree (not just this package) so it
 * catches a future consumer regression anywhere in `apps/` or `packages/`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../../");

const SCAN_ROOTS = ["apps", "packages"];
const IGNORED_DIR_NAMES = new Set(["node_modules", "dist", ".turbo", ".next", "coverage"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function listSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      listSourceFiles(fullPath, out);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      out.push(fullPath);
    }
  }

  return out;
}

const ROOT_BARREL_SPECIFIER_PATTERN = /from\s+["']@kinora\/domain["']/;
const PROGRESS_SUBPATH_SPECIFIER_PATTERN = /from\s+["']@kinora\/domain\/progress["']/;

/**
 * Timeout for the repository-wide scan below (#423).
 *
 * The default 5s was not protecting anything here, and it failed roughly half
 * the runs under `pnpm -r --if-present test:coverage` — the command the
 * pre-push hook and CI both use, which starts seven packages' vitest processes
 * at once. Measured on this tree (954 `.ts`/`.tsx` files under `apps/` and
 * `packages/`):
 *
 * | condition                          | duration |
 * |------------------------------------|----------|
 * | walk + read alone, warm page cache | ~130ms   |
 * | this test standalone, warm         | 160–352ms|
 * | this test standalone, cold cache   | 4119ms   |
 * | this test under the parallel run   | 532–2301ms (two identical runs) |
 *
 * The work is ~130ms; everything above that is page-cache misses and CPU
 * contention, and it varies by more than 25x between runs on ONE machine.
 * 5s sat inside that spread, so the guard failed for reasons no developer
 * could act on — which trains re-running an architecture guard until green,
 * exactly the reflex that lets a genuine violation through.
 *
 * 30s is ~7x the worst observed. It still fails fast against a real hang
 * (unbounded), which is all a timeout is for: a filesystem walk that honestly
 * takes 4s is not a bug, and one that takes 30s means the tree grew sevenfold
 * or the machine is pathological — both worth hearing about.
 *
 * Deliberately NOT fixed by narrowing the scan. Scanning everything is the
 * entire value of this guard; a partial scan would pass for the wrong reason.
 */
const SCAN_TIMEOUT_MS = 30_000;

describe("@kinora/domain/progress subpath isolation (09c-v1 Slice 1a)", () => {
  it("the root barrel (packages/domain/src/index.ts) never re-exports ./progress", () => {
    const rootBarrelPath = resolve(__dirname, "../../index.ts");
    const rootBarrelSource = readFileSync(rootBarrelPath, "utf-8");

    expect(rootBarrelSource).not.toMatch(/["']\.\/progress/);
  });

  // The timeout is on THIS test only. The single-file read above stays at the
  // default 5s, and so does every other test in the package: a genuinely
  // hanging test elsewhere must still fail fast.
  it("no consumer file in apps/ or packages/ imports both the progress subpath and the root barrel", { timeout: SCAN_TIMEOUT_MS }, () => {
    const files = SCAN_ROOTS.flatMap((root) => listSourceFiles(join(REPO_ROOT, root)));

    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf-8");
      return (
        PROGRESS_SUBPATH_SPECIFIER_PATTERN.test(source) && ROOT_BARREL_SPECIFIER_PATTERN.test(source)
      );
    });

    expect(offenders).toEqual([]);
  });
});
