/**
 * One answer to "what are the workspace packages?", shared by every guard that
 * needs it.
 *
 * Both repository guards used to answer it themselves — `deps-guard.mjs` from a
 * hardcoded list of package.json paths, `assert-test-dirs-have-a-project.mjs`
 * from its own copy of the `pnpm-workspace.yaml` parser. The hardcoded list had
 * already drifted: `packages/i18n` was added to the workspace and never added to
 * the list, so its dependencies were checked by nothing at all, and every future
 * package would have been missed the same way. Two answers to one question is
 * how the second one falls behind.
 *
 * Discovery is derived from `pnpm-workspace.yaml` and then reconciled against
 * pnpm's own enumeration, so the guards cannot quietly disagree with the tool
 * that actually resolves the workspace.
 *
 * Package directories are root-relative POSIX paths; the workspace root is `"."`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** The raw `packages:` entries of a `pnpm-workspace.yaml`, in file order. */
export function parseWorkspaceGlobStrings(yaml) {
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
  return globs;
}

/**
 * Those globs as regexes over root-relative directory paths. Only `*` is
 * supported, and it never crosses a `/` — the same single-level meaning pnpm
 * gives `apps/*`, so `apps/api/scripts` is not a workspace package.
 */
export function parseWorkspaceGlobs(yaml) {
  return parseWorkspaceGlobStrings(yaml).map(
    (glob) =>
      new RegExp(
        `^${glob
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*")}$`,
      ),
  );
}

/** Root-relative directories a glob could describe, one level per `*` segment. */
function expandGlobDirectories(root, glob) {
  const segments = glob.split("/");
  let candidates = [""];
  for (const segment of segments) {
    const next = [];
    for (const base of candidates) {
      const absolute = join(root, base);
      if (!existsSync(absolute)) continue;
      if (segment.includes("*")) {
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
          if (entry.isDirectory()) next.push(base ? `${base}/${entry.name}` : entry.name);
        }
      } else {
        next.push(base ? `${base}/${segment}` : segment);
      }
    }
    candidates = next;
  }
  return candidates;
}

/**
 * Workspace package directories on disk, root-relative and sorted, excluding
 * the workspace root. A directory counts only if it matches a glob AND holds a
 * package.json — a stray directory under `packages/` is not a package.
 */
export function discoverWorkspacePackageDirs(root, yaml) {
  const dirs = new Set();
  for (const glob of parseWorkspaceGlobStrings(yaml)) {
    for (const dir of expandGlobDirectories(root, glob)) {
      if (dir !== "" && existsSync(join(root, dir, "package.json"))) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

/**
 * The workspace projects pnpm itself resolves, root-relative and sorted, with
 * the workspace root reported as `"."`.
 *
 * pnpm is the authority here: if this disagrees with `discoverWorkspacePackageDirs`
 * the guard's view of the repository is wrong, and it must say so rather than
 * check a set of packages nobody else recognises.
 */
export function listPnpmProjectDirs(root) {
  const stdout = execFileSync(
    "pnpm",
    ["list", "-r", "--depth", "-1", "--json"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 32 * 1024 * 1024 },
  );
  const start = stdout.indexOf("[");
  if (start === -1) {
    throw new Error("pnpm list produced no JSON array; the workspace could not be enumerated");
  }
  return JSON.parse(stdout.slice(start))
    .map((project) => relative(resolve(root), resolve(project.path)).split(sep).join("/") || ".")
    .sort();
}

/**
 * Differences between the guard's discovery (root-relative dirs, root excluded)
 * and pnpm's enumeration (root included). Either direction is a failure: one
 * means the guard would skip a real package, the other that it invented one.
 */
export function reconcileWorkspaceDiscovery(discovered, pnpmDirs) {
  const ours = new Set([".", ...discovered]);
  const theirs = new Set(pnpmDirs);
  return {
    missedByGuard: [...theirs].filter((dir) => !ours.has(dir)).sort(),
    unknownToPnpm: [...ours].filter((dir) => !theirs.has(dir)).sort(),
  };
}

/** Parsed package.json for a root-relative directory, or `null` when absent. */
export function readWorkspacePackageJson(root, dir) {
  const path = join(root, dir, "package.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}
