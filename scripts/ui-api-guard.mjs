#!/usr/bin/env node

/**
 * UI → API guardrail — ensures no client component calls the API directly.
 *
 * ARCHITECTURE RULE
 * -----------------
 * The browser talks to Next.js (server components / server actions), which
 * proxies to the API server-to-server via the INTERNAL API_BASE_URL
 * (http://api:4000). The ONLY legitimate browser→API channel is the WebSocket,
 * because a WebSocket cannot be proxied through Next.js; it requires a direct
 * connection using the PUBLIC origin (NEXT_PUBLIC_API_BASE_URL). Everything
 * else — REST fetches, status polls, mutations — MUST go through a server action.
 *
 * LAYERED DEFENCE
 * ---------------
 * `import "server-only"` in API-fetch modules is the BUILD-TIME backstop for
 * import-path violations: if a client component (or a module it imports)
 * contains `import "server-only"`, `next build` fails with a clear error,
 * regardless of how the import reaches it (direct, barrel re-export, or
 * dynamic import).
 *
 * This script is the RUNTIME-STATIC layer that catches what server-only
 * CANNOT: inline fetch / env / URL access in client files that do not import
 * a server-only module. It also enforces the browser→API allowlist (below).
 *
 * The guard additionally reports server-only import violations (static
 * imports and dynamic imports) so they are visible in CI output, even though
 * `next build` would catch them at compile time.
 *
 * KNOWN LIMITATION
 * ----------------
 * A client file that constructs the API URL from a fully dynamic string
 * (e.g. a variable built at runtime from user input) cannot be caught
 * statically. This is expected — review dynamic URL construction manually.
 *
 * BROWSER → API ALLOWLIST
 * -----------------------
 * Only these files may reference NEXT_PUBLIC_API_BASE_URL or connect to the
 * API from the browser. All other client files must go through a server action.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const WEB_SRC = join(ROOT, "apps/web/src");
const HOOKS_DIR = join(WEB_SRC, "hooks");

/**
 * Explicit allowlist of client files that are permitted to reference
 * NEXT_PUBLIC_API_BASE_URL and connect to the API from the browser.
 *
 * WHY an allowlist instead of a blanket exception: the WebSocket hook is the
 * ONLY client code that legitimately reaches the API from the browser (it
 * cannot be proxied through Next.js). Any other client file using
 * NEXT_PUBLIC_API_BASE_URL would be making a direct browser→API REST call,
 * which violates the rule. The allowlist makes this boundary explicit and
 * auditable.
 */
const BROWSER_API_ALLOWLIST = new Set([
  join(WEB_SRC, "hooks/use-plan-ws.ts"),
]);

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
      if (!/\.(tsx?)$/.test(entry)) continue;
      if (/\.test\.(tsx?)$/.test(entry)) continue;
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
// Violation detection patterns
// ---------------------------------------------------------------------------

/** Internal API_BASE_URL (server-only env var) — never allowed in client. */
const API_BASE_URL_RE =
  /process\.env(?:\.API_BASE_URL|\[["']API_BASE_URL["']\])/g;

/**
 * NEXT_PUBLIC_API_BASE_URL — only allowed in the BROWSER_API_ALLOWLIST files.
 * For all other client files this is a violation (browser→API REST call).
 */
const NEXT_PUBLIC_API_BASE_URL_RE =
  /process\.env(?:\.NEXT_PUBLIC_API_BASE_URL|\[["']NEXT_PUBLIC_API_BASE_URL["']\])/g;

/**
 * Hardcoded internal API compose host — always fails in client files.
 * `http://api:4000` only resolves inside the Docker network; using it in a
 * client component means the browser would make a direct API call that fails
 * in production.
 */
const COMPOSE_HOST_RE = /https?:\/\/api:\d+/g;

/**
 * Localhost API fallback — flagged in non-allowlisted client files.
 * `http://localhost:4000` is the local dev fallback for API_BASE_URL.
 * It is legitimate ONLY inside the WS hook allowlist (for the WebSocket
 * dev fallback). In any other client file it indicates a direct browser→API
 * call that would fail in deployed environments.
 */
const LOCALHOST_API_RE = /https?:\/\/localhost:\d+/g;

/**
 * Static import statement — captures specifier on a potentially multiline import.
 * Fix 1: content is normalized (newlines collapsed to spaces) before matching
 * so multiline imports like:
 *   import {
 *     foo,
 *   } from "./module"
 * are correctly detected.
 */
const STATIC_IMPORT_RE =
  /\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;

/**
 * Dynamic import — captures the specifier in import("./module").
 * Fix 2: catches dynamic imports of server-only modules.
 */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

// ---------------------------------------------------------------------------
// Violation check for a single client file
// ---------------------------------------------------------------------------

/**
 * Check a single client file for violations.
 * Returns an array of { line, col, token, remedy } objects.
 *
 * @param {string} filePath  Absolute path to the file.
 * @param {string} content   Raw file content (original, newlines preserved).
 * @param {Set<string>} serverOnlyModules  Absolute paths of server-only modules.
 * @param {boolean} isAllowlisted  Whether this file is in BROWSER_API_ALLOWLIST.
 */
function checkClientFile(filePath, content, serverOnlyModules, isAllowlisted) {
  const violations = [];
  const lines = content.split("\n");

  // --- Check 1: process.env.API_BASE_URL (internal — never allowed in client) ---
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    API_BASE_URL_RE.lastIndex = 0;
    let match;
    while ((match = API_BASE_URL_RE.exec(line)) !== null) {
      violations.push({
        line: i + 1,
        col: match.index + 1,
        token: match[0].trim(),
        remedy:
          "Client components must call a server action, not the API directly. " +
          "Move the fetch call to a server action; use NEXT_PUBLIC_API_BASE_URL only for the WebSocket hook.",
      });
    }
  }

  // --- Check 2: NEXT_PUBLIC_API_BASE_URL (only allowed in BROWSER_API_ALLOWLIST) ---
  if (!isAllowlisted) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      NEXT_PUBLIC_API_BASE_URL_RE.lastIndex = 0;
      let match;
      while ((match = NEXT_PUBLIC_API_BASE_URL_RE.exec(line)) !== null) {
        violations.push({
          line: i + 1,
          col: match.index + 1,
          token: match[0].trim(),
          remedy:
            "NEXT_PUBLIC_API_BASE_URL is only permitted in the browser→API allowlist " +
            "(currently: use-plan-ws.ts, for the WebSocket channel). " +
            "Route this call through a server action instead.",
        });
      }
    }
  }

  // --- Check 3a: hardcoded internal Docker compose host (always forbidden) ---
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    COMPOSE_HOST_RE.lastIndex = 0;
    let match;
    while ((match = COMPOSE_HOST_RE.exec(line)) !== null) {
      violations.push({
        line: i + 1,
        col: match.index + 1,
        token: match[0].trim(),
        remedy:
          "Hardcoded internal Docker compose host (http://api:<port>) in a client file. " +
          "This URL only resolves inside the Docker network — the browser cannot reach it. " +
          "Client components must call a server action.",
      });
    }
  }

  // --- Check 3b: localhost API fallback (only forbidden outside the allowlist) ---
  if (!isAllowlisted) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      LOCALHOST_API_RE.lastIndex = 0;
      let match;
      while ((match = LOCALHOST_API_RE.exec(line)) !== null) {
        violations.push({
          line: i + 1,
          col: match.index + 1,
          token: match[0].trim(),
          remedy:
            "Hardcoded localhost API URL in a client file (http://localhost:<port>). " +
            "This is typically an API_BASE_URL fallback — client components must call a server action instead.",
        });
      }
    }
  }

  // --- Check 4: static imports from server-only modules (Fix 1: normalize newlines) ---
  const scan = content.replace(/\r?\n/g, " ");
  STATIC_IMPORT_RE.lastIndex = 0;
  let importMatch;
  while ((importMatch = STATIC_IMPORT_RE.exec(scan)) !== null) {
    const specifier = importMatch[1];
    // Only resolve relative or @/ imports — npm packages are not files we own
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;

    const resolved = resolveImport(specifier, filePath);
    if (!resolved) continue;

    if (serverOnlyModules.has(resolved)) {
      // Compute line number from position in normalized string (spaces = newlines)
      // Since we collapsed newlines to spaces in `scan`, use the original content
      // to find the position — count newlines up to the same character offset.
      const before = content.slice(0, importMatch.index);
      const lineNum = (before.match(/\n/g) ?? []).length + 1;
      violations.push({
        line: lineNum,
        col: 1,
        token: `import ... from '${specifier}'`,
        remedy:
          "Client components must call a server action, not the API directly. " +
          `'${specifier}' is a server-only module — import from the client-safe constants file or call a server action. ` +
          "(Note: next build also enforces this at compile time via server-only.)",
      });
    }
  }

  // --- Check 5: dynamic imports of server-only modules (Fix 2) ---
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  let dynMatch;
  while ((dynMatch = DYNAMIC_IMPORT_RE.exec(content)) !== null) {
    const specifier = dynMatch[1];
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;

    const resolved = resolveImport(specifier, filePath);
    if (!resolved) continue;

    if (serverOnlyModules.has(resolved)) {
      const before = content.slice(0, dynMatch.index);
      const lineNum = (before.match(/\n/g) ?? []).length + 1;
      violations.push({
        line: lineNum,
        col: 1,
        token: `import('${specifier}')`,
        remedy:
          "Dynamic import of a server-only module from a client component. " +
          `'${specifier}' is server-only — call a server action instead.`,
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

  const isAllowlisted = BROWSER_API_ALLOWLIST.has(filePath);
  const violations = checkClientFile(
    filePath,
    content,
    serverOnlyModules,
    isAllowlisted
  );
  if (violations.length === 0) continue;

  hasViolations = true;
  const relPath = relative(ROOT, filePath);

  for (const v of violations) {
    totalViolations += 1;
    console.error(`❌  ${relPath}:${v.line}:${v.col}  [${v.token}]`);
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
