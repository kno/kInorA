/**
 * Unit tests for the orphaned-test-directory guard
 * (`scripts/assert-test-dirs-have-a-project.mjs`, issue #437).
 *
 * The guard is the deliverable of #437: it is what stops a fourth directory of
 * tests from existing in no vitest project. A guard is only worth its message
 * if it fails when it should, so these tests drive its pure helpers with
 * fixtures that reproduce each orphaning shape it claims to catch — including
 * the vacuity cases, where the guard must fail rather than pass having examined
 * nothing.
 *
 * The module is guarded by an `isMain` check, so importing it here neither
 * shells out to git nor runs vitest.
 *
 * Layers used: Unit (no runtime boundary).
 */
import { describe, expect, it } from "vitest";

import {
  classifyReachability,
  collectTestDirs,
  collectTestFiles,
  discoverProjects,
  findUnclaimed,
  parseWorkspaceGlobs,
  rootScriptRunsVitest,
  vacuityErrors,
} from "../assert-test-dirs-have-a-project.mjs";

const WORKSPACE_YAML = 'packages:\n  - "apps/*"\n  - "packages/*"\n';
const globs = parseWorkspaceGlobs(WORKSPACE_YAML);

function readPackageJsonFrom(entries: Record<string, unknown>) {
  return (dir: string) => (dir in entries ? entries[dir] : null);
}

describe("collectTestFiles", () => {
  it("keeps every vitest suite extension and drops Playwright specs", () => {
    expect(
      collectTestFiles([
        "packages/domain/src/__tests__/a.test.ts",
        "apps/web/src/__tests__/b.test.tsx",
        "scripts/__tests__/c.test.mjs",
        "tests/e2e/pwa.spec.ts",
        "apps/api/src/db/schema.ts",
        "apps/api/src/ai/__tests__/__snapshots__/x.test.ts.snap",
      ]),
    ).toEqual([
      "apps/web/src/__tests__/b.test.tsx",
      "packages/domain/src/__tests__/a.test.ts",
      "scripts/__tests__/c.test.mjs",
    ]);
  });
});

describe("collectTestDirs", () => {
  it("reports each __tests__ directory once, including nested ones", () => {
    expect(
      collectTestDirs([
        "apps/web/src/__tests__/a.test.ts",
        "apps/web/src/__tests__/b.test.ts",
        "apps/web/src/hooks/__tests__/c.test.ts",
        "apps/api/src/billing/coverage-mode.test.ts",
      ]),
    ).toEqual(["apps/web/src/__tests__", "apps/web/src/hooks/__tests__"]);
  });
});

describe("discoverProjects", () => {
  it("finds the root project and every package project from config files alone", () => {
    expect(
      discoverProjects([
        "vitest.config.ts",
        "apps/api/vitest.config.ts",
        "packages/i18n/vitest.config.mts",
        "vitest.shared.ts",
        "apps/web/next.config.ts",
      ]),
    ).toEqual([".", "apps/api", "packages/i18n"]);
  });

  it("returns nothing when no vitest config exists, so vacuity can be reported", () => {
    expect(discoverProjects(["package.json", "README.md"])).toEqual([]);
  });
});

describe("parseWorkspaceGlobs", () => {
  it("matches only the directory depth the glob describes", () => {
    expect(globs.some((glob) => glob.test("apps/api"))).toBe(true);
    expect(globs.some((glob) => glob.test("packages/domain"))).toBe(true);
    // `apps/*` is one level: a nested directory is NOT a workspace package.
    expect(globs.some((glob) => glob.test("apps/api/scripts"))).toBe(false);
    expect(globs.some((glob) => glob.test("scripts"))).toBe(false);
    expect(globs.some((glob) => glob.test("."))).toBe(false);
  });

  it("ignores keys other than `packages:`", () => {
    expect(parseWorkspaceGlobs('onlyBuiltDependencies:\n  - "esbuild"\n')).toEqual([]);
  });
});

describe("rootScriptRunsVitest", () => {
  it("accepts vitest chained after the recursive run", () => {
    expect(rootScriptRunsVitest({ test: "pnpm -r test && vitest run" })).toBe(true);
  });

  it("follows one level of root script indirection", () => {
    expect(
      rootScriptRunsVitest({
        test: "pnpm -r test && pnpm test:scripts",
        "test:scripts": "vitest run",
      }),
    ).toBe(true);
  });

  it("rejects the recursive run on its own — `pnpm -r` skips the workspace root", () => {
    expect(rootScriptRunsVitest({ test: "pnpm -r test" })).toBe(false);
  });

  it("rejects a chained script that does not actually run vitest", () => {
    expect(
      rootScriptRunsVitest({
        test: "pnpm -r test && pnpm test:scripts",
        "test:scripts": "echo skipped",
      }),
    ).toBe(false);
  });

  it("rejects an absent test script", () => {
    expect(rootScriptRunsVitest({})).toBe(false);
  });
});

describe("classifyReachability", () => {
  it("accepts a workspace package with a test script", () => {
    expect(
      classifyReachability("apps/api", {
        globs,
        readPackageJson: readPackageJsonFrom({
          "apps/api": { scripts: { test: "vitest run" } },
        }),
      }),
    ).toEqual({ reachable: true });
  });

  it("rejects a workspace package whose package.json has no test script", () => {
    const result = classifyReachability("packages/domain", {
      globs,
      readPackageJson: readPackageJsonFrom({
        "packages/domain": { scripts: { build: "tsc" } },
      }),
    });
    expect(result.reachable).toBe(false);
    expect(result.reason).toMatch(/no `test` script/);
  });

  it("rejects a config in a directory no workspace glob matches", () => {
    const result = classifyReachability("tooling/linter", {
      globs,
      readPackageJson: readPackageJsonFrom({
        "tooling/linter": { scripts: { test: "vitest run" } },
      }),
    });
    expect(result.reachable).toBe(false);
    expect(result.reason).toMatch(/pnpm-workspace\.yaml/);
  });

  it("rejects a matched directory that has no package.json at all", () => {
    const result = classifyReachability("packages/orphan", {
      globs,
      readPackageJson: readPackageJsonFrom({}),
    });
    expect(result.reachable).toBe(false);
    expect(result.reason).toMatch(/no package\.json/);
  });

  it("judges the root project by the root test script rather than by a glob", () => {
    expect(
      classifyReachability(".", {
        globs,
        readPackageJson: readPackageJsonFrom({
          ".": { scripts: { test: "pnpm -r test && vitest run" } },
        }),
      }),
    ).toEqual({ reachable: true });

    const result = classifyReachability(".", {
      globs,
      readPackageJson: readPackageJsonFrom({ ".": { scripts: { test: "pnpm -r test" } } }),
    });
    expect(result.reachable).toBe(false);
    expect(result.reason).toMatch(/skips the workspace root/);
  });
});

describe("findUnclaimed", () => {
  const testFiles = [
    "packages/domain/src/__tests__/a.test.ts",
    "scripts/__tests__/b.test.ts",
    "scripts/__tests__/c.test.ts",
  ];
  const testDirs = collectTestDirs(testFiles);

  it("reproduces #437 — an entire directory claimed by no project", () => {
    expect(
      findUnclaimed({
        testFiles,
        testDirs,
        claimedFiles: ["packages/domain/src/__tests__/a.test.ts"],
      }),
    ).toEqual({
      files: ["scripts/__tests__/b.test.ts", "scripts/__tests__/c.test.ts"],
      dirs: ["scripts/__tests__"],
    });
  });

  it("still names a single unclaimed file whose sibling is claimed", () => {
    const result = findUnclaimed({
      testFiles,
      testDirs,
      claimedFiles: [
        "packages/domain/src/__tests__/a.test.ts",
        "scripts/__tests__/b.test.ts",
      ],
    });
    expect(result.files).toEqual(["scripts/__tests__/c.test.ts"]);
    // The directory is partially covered, so only the file-level check fires.
    expect(result.dirs).toEqual([]);
  });

  it("reports nothing when every file is claimed", () => {
    expect(findUnclaimed({ testFiles, testDirs, claimedFiles: testFiles })).toEqual({
      files: [],
      dirs: [],
    });
  });
});

describe("vacuityErrors", () => {
  it("passes only when projects, files and directories were all found", () => {
    expect(
      vacuityErrors({
        projects: ["."],
        testFiles: ["scripts/__tests__/a.test.ts"],
        testDirs: ["scripts/__tests__"],
      }),
    ).toEqual([]);
  });

  it("fails when discovery found no vitest project", () => {
    expect(
      vacuityErrors({
        projects: [],
        testFiles: ["scripts/__tests__/a.test.ts"],
        testDirs: ["scripts/__tests__"],
      }).join(" "),
    ).toMatch(/no vitest project was discovered/);
  });

  it("fails when the file listing produced no test files", () => {
    expect(vacuityErrors({ projects: ["."], testFiles: [], testDirs: [] }).length).toBe(2);
  });

  it("fails when no __tests__ directory was found, even with loose test files", () => {
    expect(
      vacuityErrors({
        projects: ["."],
        testFiles: ["apps/api/src/billing/coverage-mode.test.ts"],
        testDirs: [],
      }).join(" "),
    ).toMatch(/__tests__ directory was discovered/);
  });
});
