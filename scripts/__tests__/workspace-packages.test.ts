/**
 * Unit tests for the shared workspace-package discovery
 * (`scripts/workspace-packages.mjs`).
 *
 * This module exists because two guards answered "what are the workspace
 * packages?" separately and one of the answers drifted: `deps-guard.mjs` kept a
 * hardcoded list of package.json paths that `packages/i18n` was never added to.
 * Now that both guards share this code, its glob semantics and its reconciliation
 * against pnpm's own enumeration are what stop the whole class of drift — so
 * they are pinned here rather than assumed.
 *
 * `discoverWorkspacePackageDirs` is exercised against a real temporary tree
 * (fixtures on disk, not a mocked `fs`) because the behaviour under test is
 * precisely how it reads a directory.
 *
 * Layers used: Unit (filesystem fixtures only; no network, no subprocess).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  discoverWorkspacePackageDirs,
  parseWorkspaceGlobStrings,
  parseWorkspaceGlobs,
  readWorkspacePackageJson,
  reconcileWorkspaceDiscovery,
} from "../workspace-packages.mjs";

const WORKSPACE_YAML = 'packages:\n  - "apps/*"\n  - "packages/*"\n';

describe("parseWorkspaceGlobStrings", () => {
  it("reads quoted and unquoted entries in file order", () => {
    expect(parseWorkspaceGlobStrings('packages:\n  - "apps/*"\n  - packages/*\n')).toEqual([
      "apps/*",
      "packages/*",
    ]);
  });

  it("stops at the next top-level key and ignores unrelated ones", () => {
    expect(
      parseWorkspaceGlobStrings(
        'packages:\n  - "apps/*"\nonlyBuiltDependencies:\n  - "esbuild"\n',
      ),
    ).toEqual(["apps/*"]);
    expect(parseWorkspaceGlobStrings('onlyBuiltDependencies:\n  - "esbuild"\n')).toEqual([]);
  });
});

describe("parseWorkspaceGlobs", () => {
  const globs = parseWorkspaceGlobs(WORKSPACE_YAML);
  const matches = (dir: string) => globs.some((glob) => glob.test(dir));

  it("matches only the directory depth the glob describes", () => {
    expect(matches("apps/api")).toBe(true);
    expect(matches("packages/domain")).toBe(true);
    // `apps/*` is one level: `*` must not cross a `/`, exactly as pnpm treats it.
    expect(matches("apps/api/scripts")).toBe(false);
    expect(matches("scripts")).toBe(false);
    expect(matches(".")).toBe(false);
  });

  it("escapes regex metacharacters in the literal parts of a glob", () => {
    const dotted = parseWorkspaceGlobs('packages:\n  - "a.b/*"\n');
    expect(dotted.some((glob) => glob.test("a.b/x"))).toBe(true);
    expect(dotted.some((glob) => glob.test("axb/x"))).toBe(false);
  });
});

describe("discoverWorkspacePackageDirs", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "kinora-workspace-"));
    for (const dir of [
      "apps/api",
      "apps/web",
      "packages/domain",
      "packages/i18n",
      "packages/notes", // no package.json — a directory, not a package
      "apps/api/scripts", // one level too deep for `apps/*`
      "scripts", // outside every glob
    ]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    for (const dir of [
      "apps/api",
      "apps/web",
      "packages/domain",
      "packages/i18n",
      "apps/api/scripts",
      "scripts",
      ".",
    ]) {
      writeFileSync(join(root, dir, "package.json"), "{}");
    }
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds every package the globs cover, including newly added ones", () => {
    // `packages/i18n` is the package the old hardcoded list forgot. Discovery
    // has no list to forget.
    expect(discoverWorkspacePackageDirs(root, WORKSPACE_YAML)).toEqual([
      "apps/api",
      "apps/web",
      "packages/domain",
      "packages/i18n",
    ]);
  });

  it("excludes the root, matched directories without a package.json, and paths outside the globs", () => {
    const dirs = discoverWorkspacePackageDirs(root, WORKSPACE_YAML);
    expect(dirs).not.toContain(".");
    expect(dirs).not.toContain("packages/notes");
    expect(dirs).not.toContain("apps/api/scripts");
    expect(dirs).not.toContain("scripts");
  });

  it("returns nothing when the globs match no directory, so vacuity is visible", () => {
    expect(discoverWorkspacePackageDirs(root, 'packages:\n  - "nowhere/*"\n')).toEqual([]);
  });
});

describe("reconcileWorkspaceDiscovery", () => {
  it("agrees when discovery covers exactly what pnpm resolves", () => {
    expect(
      reconcileWorkspaceDiscovery(
        ["apps/api", "packages/i18n"],
        [".", "apps/api", "packages/i18n"],
      ),
    ).toEqual({ missedByGuard: [], unknownToPnpm: [] });
  });

  it("names a package pnpm resolves that the guard would have skipped", () => {
    // The i18n failure in its general form: the guard checks less than exists.
    expect(
      reconcileWorkspaceDiscovery(["apps/api"], [".", "apps/api", "packages/i18n"]),
    ).toEqual({ missedByGuard: ["packages/i18n"], unknownToPnpm: [] });
  });

  it("names a directory the guard invented that pnpm does not recognise", () => {
    expect(
      reconcileWorkspaceDiscovery(["apps/api", "packages/ghost"], [".", "apps/api"]),
    ).toEqual({ missedByGuard: [], unknownToPnpm: ["packages/ghost"] });
  });

  it("treats the workspace root as always covered", () => {
    expect(reconcileWorkspaceDiscovery([], ["."])).toEqual({
      missedByGuard: [],
      unknownToPnpm: [],
    });
  });
});

describe("readWorkspacePackageJson", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "kinora-pkg-"));
    mkdirSync(join(root, "apps/api"), { recursive: true });
    writeFileSync(join(root, "apps/api/package.json"), '{"name":"api"}');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("parses a package.json for a root-relative directory", () => {
    expect(readWorkspacePackageJson(root, "apps/api")).toEqual({ name: "api" });
  });

  it("returns null rather than throwing when there is none", () => {
    expect(readWorkspacePackageJson(root, "apps/web")).toBeNull();
  });
});
