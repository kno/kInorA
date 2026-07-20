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

describe("@kinora/domain/progress subpath isolation (09c-v1 Slice 1a)", () => {
  it("the root barrel (packages/domain/src/index.ts) never re-exports ./progress", () => {
    const rootBarrelPath = resolve(__dirname, "../../index.ts");
    const rootBarrelSource = readFileSync(rootBarrelPath, "utf-8");

    expect(rootBarrelSource).not.toMatch(/["']\.\/progress/);
  });

  it("no consumer file in apps/ or packages/ imports both the progress subpath and the root barrel", () => {
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
