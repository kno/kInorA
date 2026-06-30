#!/usr/bin/env node

/**
 * UI → API guardrail — ensures no client component calls the API directly.
 *
 * Rule: the browser talks to Next.js (server components / server actions),
 * which proxies to the API server-to-server via the INTERNAL API_BASE_URL
 * (http://api:4000). The ONLY legitimate browser→API channel is the WebSocket,
 * which uses NEXT_PUBLIC_API_BASE_URL (public origin) — a socket cannot be
 * proxied through Next.js. Everything else must go through a server action.
 *
 * Scans every .ts/.tsx under apps/web/src (recursively) excluding:
 *   - files under __tests__ directories
 *   - *.test.* files
 *   - *.d.ts files
 *
 * A file is CLIENT if:
 *   - Its first ~5 non-empty lines contain the "use client" directive, OR
 *   - It lives under apps/web/src/hooks/
 *
 * Failures (exit 1) when a CLIENT file:
 *   1. References process.env.API_BASE_URL or process.env["API_BASE_URL"]
 *      (the INTERNAL base URL — server-only).
 *   2. Imports from a module marked server-only (i.e. a file under
 *      apps/web/src whose first non-empty lines contain `import "server-only"`).
 *
 * ALLOWED: NEXT_PUBLIC_API_BASE_URL (public origin — WS channel). Not flagged.
 *
 * Exit 0 → clean. Exit 1 → violations found (with a clear per-line report).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const WEB_SRC = join(ROOT, "apps/web/src");
const HOOKS_DIR = join(WEB_SRC, "hooks");

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/** Recursively collect all .ts/.tsx files under dir, excluding test artifacts. */
function collectFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip __tests__ directories entirely
      if (entry === "__tests__") continue;
      results.push(...collectFiles(full));
    } else if (stat.isFile()) {
      // Accept .ts and .tsx; skip test files and type declarations
      if (!/\.(tsx?$)/.test(entry)) continue;
      if (/\.test\.(tsx?$)/.test(entry)) continue;
      if (/\.d\.ts$/.test(entry)) continue;
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Client file detection
// ---------------------------------------------------------------------------

const USE_CLIENT_RE = /^\s*["']use client["']/;

/** Read the first few non-empty lines of a file. */
function firstNonEmptyLines(content, count) {
  const lines = content.split("\n");
  const nonEmpty = [];
  for (const line of lines) {
    if (line.trim() !== "") {
      nonEmpty.push(line);
      if (nonEmpty.length >= count) break;
    }
  }
  return nonEmpty;
}

function isClientFile(filePath, content) {
  // Files under hooks/ are always treated as client modules
  if (filePath.startsWith(HOOKS_DIR + "/") || filePath === HOOKS_DIR) {
    return true;
  }
  // Check for "use client" in the first 5 non-empty lines
  const head = firstNonEmptyLines(content, 5);
  return head.some((line) => USE_CLIENT_RE.test(line));
}

// ---------------------------------------------------------------------------
// Server-only module detection
// ---------------------------------------------------------------------------

const SERVER_ONLY_RE = /^\s*import\s+["']server-only["']/;

/** Collect all files under WEB_SRC that contain `import "server-only"` near the top. */
function collectServerOnlyModules(allFiles) {
  const serverOnlySet = new Set();
  for (const filePath of allFiles) {
    let content;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const head = firstNonEmptyLines(content, 5);
    if (head.some((line) => SERVER_ONLY_RE.test(line))) {
      serverOnlySet.add(filePath);
    }
  }
  return serverOnlySet;
}

// ---------------------------------------------------------------------------
// Import resolution — resolve a relative or @/ import to a file path
// ---------------------------------------------------------------------------

/** Attempt to resolve an import specifier to an absolute path. */
function resolveImport(specifier, fromFile) {
  const fromDir = dirname(fromFile);

  // Handle @/ alias → apps/web/src/
  const resolved = specifier.startsWith("@/")
    ? join(WEB_SRC, specifier.slice(2))
    : resolve(fromDir, specifier);

  // Try exact path first, then common extensions
  const candidates = [
    resolved,
    resolved + ".ts",
    resolved + ".tsx",
    join(resolved, "index.ts"),
    join(resolved, "index.tsx"),
  ];
  for (const candidate of candidates) {
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // not found — try next
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Violation detection
// ---------------------------------------------------------------------------

const API_BASE_URL_RE =
  /process\.env(?:\.API_BASE_URL|\[["']API_BASE_URL["']\])/g;

// Matches import statements — captures the specifier (non-npm, relative or @/)
const IMPORT_RE =
  /^\s*import\s+(?:.*?\s+from\s+)?["']([^"']+)["']/gm;

/**
 * Check a single client file for violations.
 * Returns an array of { line, col, token, remedy } objects.
 */
function checkClientFile(filePath, content, serverOnlyModules) {
  const violations = [];
  const lines = content.split("\n");

  // Check 1: API_BASE_URL reference
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    API_BASE_URL_RE.lastIndex = 0;
    while ((match = API_BASE_URL_RE.exec(line)) !== null) {
      violations.push({
        line: i + 1,
        col: match.index + 1,
        token: match[0].trim(),
        remedy:
          "Client components must call a server action, not the API directly. " +
          "Move the fetch call to a server action and import NEXT_PUBLIC_API_BASE_URL for public-origin calls only.",
      });
    }
  }

  // Check 2: imports from server-only modules
  let importMatch;
  IMPORT_RE.lastIndex = 0;
  while ((importMatch = IMPORT_RE.exec(content)) !== null) {
    const specifier = importMatch[1];
    // Only resolve relative or @/ imports — npm packages are not files we own
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;

    const resolved = resolveImport(specifier, filePath);
    if (!resolved) continue;

    if (serverOnlyModules.has(resolved)) {
      // Find line number by counting newlines before this match position
      const before = content.slice(0, importMatch.index);
      const lineNum = before.split("\n").length;
      violations.push({
        line: lineNum,
        col: 1,
        token: `import ... from '${specifier}'`,
        remedy:
          "Client components must call a server action, not the API directly. " +
          `'${specifier}' is a server-only module — import from the client-safe constants file or call a server action.`,
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const allFiles = collectFiles(WEB_SRC);
const serverOnlyModules = collectServerOnlyModules(allFiles);

let hasViolations = false;
let totalClientFiles = 0;
let totalViolations = 0;

for (const filePath of allFiles) {
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    console.error(`⚠️  Could not read ${filePath}`);
    continue;
  }

  if (!isClientFile(filePath, content)) continue;
  totalClientFiles += 1;

  const violations = checkClientFile(filePath, content, serverOnlyModules);
  if (violations.length === 0) continue;

  hasViolations = true;
  const relPath = relative(ROOT, filePath);

  for (const v of violations) {
    totalViolations += 1;
    console.error(
      `❌  ${relPath}:${v.line}:${v.col}  [${v.token}]`
    );
    console.error(`    Remedy: ${v.remedy}`);
  }
}

if (hasViolations) {
  console.error(
    `\n❌  UI → API guardrail failed: ${totalViolations} violation(s) across client components.`
  );
  console.error(
    "   Client components must call server actions, not the API directly.\n"
  );
  process.exit(1);
}

console.log(
  `✅  UI → API guardrail passed — ${totalClientFiles} client file(s) scanned, no violations found.`
);
