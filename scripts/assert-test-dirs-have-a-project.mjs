#!/usr/bin/env node
/**
 * Repository guard: every test file on disk must belong to a vitest project
 * that `pnpm test` actually invokes (issue #437).
 *
 * This is the third time the same shape has shipped:
 *
 *   #392 — the integration job named its suites in a hardcoded list, and eight
 *          of eighteen suites had fallen outside it. They ran in no CI job.
 *   #404 — the coverage job ran without DATABASE_URL, so every integration
 *          suite skipped and contributed nothing. Fixing it immediately
 *          surfaced a real lost-update defect (#421) that had been invisible.
 *   #437 — `scripts/__tests__/` belonged to no vitest project at all. Four
 *          suites, ~37KB, had never executed once.
 *
 * Every time, the tests existed, looked fine, and passed review. A test that
 * never runs is indistinguishable from a passing one, so no amount of care in
 * review catches this — only an enumeration does. This guard performs that
 * enumeration: it asks each vitest project which files it would run, compares
 * the union against what is actually on disk, and names the difference.
 *
 * Three checks, each catching a different way a suite can be orphaned:
 *
 *   1. UNCLAIMED FILES — a `*.test.*` file that no project lists. This is #437
 *      exactly: `scripts/__tests__` sat outside every package root, so no
 *      `include` pattern could reach it.
 *
 *   2. UNCLAIMED DIRECTORIES — a `__tests__` directory none of whose files are
 *      claimed. Redundant with (1) under the usual naming, but it keeps the
 *      failure message pointed at the directory a human would recognise.
 *
 *   3. UNREACHABLE PROJECTS — a vitest config that `pnpm test` never invokes:
 *      a workspace package with no `test` script, a directory matched by no
 *      `pnpm-workspace.yaml` glob (so `pnpm -r` walks past it), or a root
 *      project the root `test` script forgot to run. A project can list every
 *      file correctly and still verify nothing if nothing calls it.
 *
 * Vacuity is failure. Every input set is asserted non-empty before it is
 * trusted — no projects, no test files, no discovered directories, or a project
 * that lists nothing are all reported as errors rather than passing silently.
 * A guard that can go green having examined nothing is the very defect it
 * exists to prevent.
 *
 * The file listing includes untracked-but-not-ignored files on purpose: a suite
 * added in the working tree must be judged before it is committed, not one
 * commit later.
 *
 * Pure helpers are exported for `scripts/__tests__/assert-test-dirs-have-a-project.test.ts`;
 * the `isMain` guard keeps importing this module free of side effects.
 *
 * Usage: node scripts/assert-test-dirs-have-a-project.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

/** Files vitest treats as suites here. Playwright specs (`*.spec.ts`) are excluded. */
export const TEST_FILE = /\.test\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const VITEST_CONFIG = /(?:^|\/)vitest\.config\.(?:ts|mts|cts|js|mjs|cjs)$/;
export const TESTS_DIR_SEGMENT = "__tests__";

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Root-relative test files, in stable order. */
export function collectTestFiles(files) {
  return files.filter((file) => TEST_FILE.test(file)).sort();
}

/** Directories under a `__tests__` segment that hold at least one test file. */
export function collectTestDirs(testFiles) {
  return [
    ...new Set(
      testFiles
        .filter((file) => file.split("/").includes(TESTS_DIR_SEGMENT))
        .map((file) => dirname(file)),
    ),
  ].sort();
}

/** Every directory holding a vitest config, root-relative ("." for the root). */
export function discoverProjects(files) {
  const dirs = new Set();
  for (const file of files) {
    if (!VITEST_CONFIG.test(file)) continue;
    dirs.add(file.includes("/") ? dirname(file) : ".");
  }
  return [...dirs].sort();
}

/**
 * Directory globs from `pnpm-workspace.yaml`, as regexes over root-relative
 * directory paths. `pnpm -r` visits a package only if it matches one of these,
 * so a config outside them is unreachable however well it is written.
 */
export function parseWorkspaceGlobs(yaml) {
  const globs = [];
  let inPackages = false;
  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.trimEnd();
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const match = line.match(/^\s+-\s*["']?([^"'#]+?)["']?\s*$/);
    if (match) {
      globs.push(match[1]);
      continue;
    }
    if (line.trim() !== "") inPackages = false;
  }
  return globs.map(
    (glob) =>
      new RegExp(
        `^${glob
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*")}$`,
      ),
  );
}

/**
 * Does the workspace-root `test` script run vitest at the root, directly or
 * through another root script it chains? `pnpm -r` deliberately skips the
 * workspace root, so nothing else can reach a root project.
 */
export function rootScriptRunsVitest(scripts) {
  const testScript = scripts.test ?? "";
  const reachableScripts = new Set([testScript]);
  for (const [, name] of testScript.matchAll(/pnpm(?:\s+run)?\s+([\w:-]+)/g)) {
    if (scripts[name]) reachableScripts.add(scripts[name]);
  }
  return [...reachableScripts].some((script) =>
    /(?:^|&&|;|\|\|)\s*(?:pnpm\s+exec\s+)?vitest\s+run\b/.test(script),
  );
}

/**
 * How `pnpm test` reaches a project, or the reason it cannot.
 *
 * `readPackageJson(dir)` returns the parsed package.json for a root-relative
 * directory, or `null` when there is none.
 */
export function classifyReachability(projectDir, { globs, readPackageJson }) {
  if (projectDir === ".") {
    const scripts = readPackageJson(".")?.scripts ?? {};
    return rootScriptRunsVitest(scripts)
      ? { reachable: true }
      : {
          reachable: false,
          reason:
            "the root `test` script does not run vitest at the root. `pnpm -r test` " +
            "skips the workspace root, so this project would execute nowhere.",
        };
  }

  if (!globs.some((glob) => glob.test(projectDir))) {
    return {
      reachable: false,
      reason:
        "no `packages:` glob in pnpm-workspace.yaml matches this directory, so " +
        "`pnpm -r test` never walks into it.",
    };
  }

  const pkg = readPackageJson(projectDir);
  if (!pkg) {
    return {
      reachable: false,
      reason:
        "there is no package.json here, so pnpm does not treat it as a workspace package.",
    };
  }
  if (!(pkg.scripts ?? {}).test) {
    return {
      reachable: false,
      reason:
        "its package.json defines no `test` script, so `pnpm -r test` runs nothing here.",
    };
  }
  return { reachable: true };
}

/** Test files no project listed, and `__tests__` directories with no listed file. */
export function findUnclaimed({ testFiles, testDirs, claimedFiles }) {
  const claimed = new Set(claimedFiles);
  const files = testFiles.filter((file) => !claimed.has(file));
  const dirs = testDirs.filter((dir) =>
    testFiles
      .filter((file) => dirname(file) === dir)
      .every((file) => !claimed.has(file)),
  );
  return { files, dirs };
}

/** Reasons the run examined nothing and would therefore pass vacuously. */
export function vacuityErrors({ projects, testFiles, testDirs }) {
  const errors = [];
  if (projects.length === 0) {
    errors.push(
      "no vitest project was discovered. Either the repository lost every vitest " +
        "config or this guard's discovery is broken; it cannot have verified anything.",
    );
  }
  if (testFiles.length === 0) {
    errors.push(
      "no test files were discovered on disk. The file listing returned nothing " +
        `matching ${TEST_FILE}; this guard would pass vacuously.`,
    );
  }
  if (testDirs.length === 0) {
    errors.push(
      `no ${TESTS_DIR_SEGMENT} directory was discovered on disk. This guard exists to ` +
        "check them, so finding none means the check did not run.",
    );
  }
  return errors;
}

/* -------------------------------------------------------------------------- */
/* I/O                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Root-relative paths of every file git would keep — tracked plus untracked
 * and not ignored, node_modules excluded.
 */
function listRepositoryFiles() {
  const listing = (args) =>
    execFileSync("git", ["ls-files", "-z", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).split("\0");

  return [...listing([]), ...listing(["--others", "--exclude-standard"])].filter(
    (path) => path !== "" && !path.includes("node_modules/"),
  );
}

/**
 * The files a project would run, as root-relative paths. Asking vitest itself
 * is the point: it applies the project's real `include`, `exclude` and root
 * resolution rather than a second, drifting reimplementation of them.
 */
function listProjectFiles(projectDir) {
  const cwd = resolve(ROOT, projectDir);
  const stdout = execFileSync(
    "pnpm",
    ["exec", "vitest", "list", "--filesOnly", "--json"],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const start = stdout.indexOf("[");
  if (start === -1) {
    throw new Error(`vitest list produced no JSON array for project ${projectDir}`);
  }
  return JSON.parse(stdout.slice(start)).map((entry) =>
    relative(ROOT, realpathSync(resolve(cwd, entry.file))),
  );
}

function readPackageJson(projectDir) {
  const path = join(ROOT, projectDir, "package.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function fail(errors) {
  console.error(`ERROR: ${errors.join("\n\nERROR: ")}`);
  console.error(
    "\nA test that never runs is indistinguishable from a passing one. Wire the " +
      "files above into a vitest project that `pnpm test` invokes, or delete them.",
  );
  process.exit(1);
}

function main() {
  const files = listRepositoryFiles();
  const testFiles = collectTestFiles(files);
  const testDirs = collectTestDirs(testFiles);
  const projects = discoverProjects(files);

  const vacuity = vacuityErrors({ projects, testFiles, testDirs });
  if (vacuity.length > 0) fail(vacuity);

  const globs = parseWorkspaceGlobs(
    readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"),
  );
  if (globs.length === 0) {
    fail([
      "no `packages:` globs parsed from pnpm-workspace.yaml. Reachability could " +
        "not be judged for any workspace project.",
    ]);
  }

  const errors = [];
  for (const project of projects) {
    const { reachable, reason } = classifyReachability(project, {
      globs,
      readPackageJson,
    });
    if (!reachable) {
      errors.push(
        `vitest project "${project}" is not reachable from \`pnpm test\`: ${reason}`,
      );
    }
  }

  const claimedFiles = [];
  for (const project of projects) {
    const listed = listProjectFiles(project);
    if (listed.length === 0) {
      errors.push(
        `vitest project "${project}" lists zero test files. It contributes nothing ` +
          "and its `include` is almost certainly wrong.",
      );
    }
    claimedFiles.push(...listed);
  }

  const unclaimed = findUnclaimed({ testFiles, testDirs, claimedFiles });
  if (unclaimed.files.length > 0) {
    errors.push(
      "these test files belong to no vitest project, so their assertions run " +
        "nowhere and cannot fail:\n" +
        unclaimed.files.map((file) => `    - ${file}`).join("\n"),
    );
  }
  if (unclaimed.dirs.length > 0) {
    errors.push(
      `these ${TESTS_DIR_SEGMENT} directories are claimed by no vitest project:\n` +
        unclaimed.dirs.map((dir) => `    - ${dir}/`).join("\n"),
    );
  }

  if (errors.length > 0) fail(errors);

  console.log(
    `OK: ${testFiles.length} test files across ${testDirs.length} ${TESTS_DIR_SEGMENT} ` +
      `directories are all claimed by one of ${projects.length} vitest projects ` +
      `(${projects.join(", ")}), and every project is reachable from \`pnpm test\`.`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) main();
