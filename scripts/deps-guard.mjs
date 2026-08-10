#!/usr/bin/env node

/**
 * Dependency guard — ensures no out-of-scope packages are present.
 *
 * Capability categories:
 *   - DB packages: ALLOWED in apps/api only; BLOCKED from domain, contracts, web, mobile
 *   - AI/LLM packages: ALLOWED in apps/api only (08-v1-ai-plan-generation); BLOCKED from
 *     domain, contracts, web, mobile to keep inner layers pure and network-free
 *   - PWA packages: ALLOWED in apps/web only; BLOCKED everywhere else
 *   - Capacitor/native packages: ALLOWED at root and apps/mobile only; BLOCKED elsewhere
 *   - Stripe SDK: ALLOWED in apps/api only (11b-v1-billing-stripe-integration, the
 *     single infra adapter that verifies webhooks / creates checkout); BLOCKED elsewhere
 *   - Auth, Docker, CI/CD: BLOCKED everywhere
 *
 * The set of packages to check is DISCOVERED from pnpm-workspace.yaml, never
 * listed here. It used to be a literal array of package.json paths, and it had
 * already drifted: `packages/i18n` joined the workspace and was never added, so
 * its dependencies were checked by nothing and every future package would have
 * been missed the same way. That is the same shape as #392 (a hardcoded suite
 * list that eight suites had fallen outside of) and #437 (a test directory in no
 * vitest project) — a guard whose scope is maintained by hand eventually guards
 * less than it appears to, and nothing fails when it does.
 *
 * Discovery is then reconciled against pnpm's own workspace enumeration, so a
 * disagreement between this guard's view and the tool that actually resolves the
 * workspace is itself a failure. Finding nothing to check is a failure too: a
 * capability guard that examined zero packages must not report a clean repo.
 *
 * Exits 0 if clean, 1 with a descriptive error listing any violations.
 */

import { readFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverWorkspacePackageDirs,
  listPnpmProjectDirs,
  readWorkspacePackageJson,
  reconcileWorkspaceDiscovery,
} from "./workspace-packages.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/** The workspace root package.json, as a root-relative directory. */
const ROOT_DIR = ".";

// Packages that MUST NOT appear in any workspace dependency list.
const PROHIBITED_EVERYWHERE = [
  // Authentication
  /auth\.js/i,
  /next-auth/i,
  /passport/i,
  /oauth/i,
  /bcrypt/i,
  /argon2/i,
  // Docker
  /docker/i,
  /dockerode/i,
  // CI/CD
  /github-actions/i,
];

// DB packages: allowed ONLY in apps/api; banned from domain, contracts, web, mobile.
const DB_PATTERNS = [
  /pg/i,
  /mysql/i,
  /mongodb/i,
  /sqlite/i,
  /drizzle/i,
  /prisma/i,
  /mongoose/i,
  /knex/i,
  /sequelize/i,
  /typeorm/i,
];

// Workspaces where DB packages are permitted (API infrastructure).
const DB_ALLOWED_WORKSPACES = ["apps/api"];

// AI/LLM packages: allowed ONLY in apps/api (the runtime AI stack, 08-v1-ai-plan-generation);
// banned from domain, contracts, web, mobile to keep the inner layers pure and network-free.
const AI_PATTERNS = [
  /openai/i,
  /@ai-sdk/i,
  /ai-sdk/i,
  /langchain/i,
  /langfuse/i,
];

// Workspaces where AI packages are permitted.
const AI_ALLOWED_WORKSPACES = ["apps/api"];

// Stripe SDK: allowed ONLY in apps/api (11b-v1-billing-stripe-integration — the
// single infra adapter in db/repositories that calls the SDK); banned from
// domain, contracts, web, mobile, and root to keep payments off every other
// layer. The dependency-cruiser additionally confines the import to the infra
// layer WITHIN apps/api (api-no-stripe-outside-infra).
const STRIPE_PATTERNS = [/^stripe$/i];

// Workspaces where the Stripe SDK is permitted.
const STRIPE_ALLOWED_WORKSPACES = ["apps/api"];

// PWA packages: allowed ONLY in apps/web; banned from every other workspace.
const PWA_PATTERNS = [
  /workbox/i,
  /next-pwa/i,
  /@serwist/i,
];

// Workspaces where PWA packages are permitted (web delivery layer).
const PWA_ALLOWED_WORKSPACES = ["apps/web"];

// Capacitor/native packages: allowed ONLY at root and apps/mobile; banned elsewhere.
const CAPACITOR_PATTERNS = [
  /@capacitor/i,
  /capacitor/i,
];

// Workspaces where Capacitor packages are permitted.
// "." denotes the repository root package.json (native shell lives at root).
const CAPACITOR_ALLOWED_WORKSPACES = ["apps/mobile", ROOT_DIR];

/**
 * Every capability category, in one table. Each is a set of package-name
 * patterns plus the workspace directories allowed to depend on them; an empty
 * allowlist means nowhere. Adding a category is one entry rather than another
 * near-identical block inside the per-dependency loop.
 */
const CAPABILITY_CATEGORIES = [
  { label: "auth/Docker/CI", patterns: PROHIBITED_EVERYWHERE, allowed: [] },
  { label: "database", patterns: DB_PATTERNS, allowed: DB_ALLOWED_WORKSPACES },
  { label: "AI/LLM", patterns: AI_PATTERNS, allowed: AI_ALLOWED_WORKSPACES },
  { label: "Stripe", patterns: STRIPE_PATTERNS, allowed: STRIPE_ALLOWED_WORKSPACES },
  { label: "PWA", patterns: PWA_PATTERNS, allowed: PWA_ALLOWED_WORKSPACES },
  { label: "Capacitor", patterns: CAPACITOR_PATTERNS, allowed: CAPACITOR_ALLOWED_WORKSPACES },
];

/**
 * Allowlists are matched on the exact root-relative directory. The previous
 * substring match (`filepath.includes("apps/api")`) would also have exempted a
 * future `apps/api-legacy`.
 */
export function isAllowedWorkspace(packageDir, allowedWorkspaces) {
  return allowedWorkspaces.includes(packageDir);
}

export function collectDependencies(pkg) {
  return [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ];
}

/** Dependency names in `packageDir` that its capability allowlists forbid. */
export function findViolations(packageDir, dependencies) {
  const violations = new Set();
  for (const dep of dependencies) {
    for (const category of CAPABILITY_CATEGORIES) {
      if (isAllowedWorkspace(packageDir, category.allowed)) continue;
      if (category.patterns.some((pattern) => pattern.test(dep))) {
        violations.add(dep);
      }
    }
  }
  return [...violations];
}

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

/**
 * Renders the discovery/pnpm disagreement. Either direction is a real problem:
 * one means the guard would skip a package, the other that it is checking
 * something pnpm does not consider part of the workspace.
 */
export function describeDiscoveryMismatch({ missedByGuard, unknownToPnpm }) {
  return [
    missedByGuard.length > 0
      ? `  pnpm resolves these workspace projects that this guard did not discover:\n${missedByGuard
          .map((dir) => `    - ${dir}`)
          .join("\n")}`
      : "",
    unknownToPnpm.length > 0
      ? `  this guard discovered these directories that pnpm does not treat as workspace projects:\n${unknownToPnpm
          .map((dir) => `    - ${dir}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function main() {
  // --- Discovery -----------------------------------------------------------
  const workspaceYaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf-8");
  const packageDirs = [ROOT_DIR, ...discoverWorkspacePackageDirs(ROOT, workspaceYaml)];

  if (packageDirs.length <= 1) {
    fail(
      "no workspace packages were discovered from pnpm-workspace.yaml. This guard " +
        "would have checked the root package.json alone and reported a clean " +
        "repository having examined nothing.",
    );
  }

  // pnpm is the authority on what the workspace contains. If this guard's view
  // differs in either direction it is guarding the wrong set, which is exactly
  // how packages/i18n went unchecked — so a disagreement fails rather than being
  // silently preferred.
  const mismatch = reconcileWorkspaceDiscovery(
    packageDirs.filter((dir) => dir !== ROOT_DIR),
    listPnpmProjectDirs(ROOT),
  );

  if (mismatch.missedByGuard.length > 0 || mismatch.unknownToPnpm.length > 0) {
    fail(`workspace discovery disagrees with pnpm:\n${describeDiscoveryMismatch(mismatch)}`);
  }

  // --- Capability checks ---------------------------------------------------
  let hasViolations = false;

  for (const packageDir of packageDirs) {
    const pkg = readWorkspacePackageJson(ROOT, packageDir);
    if (!pkg) {
      fail(`could not read ${join(packageDir, "package.json")}`);
    }

    const label = packageDir === ROOT_DIR ? "package.json" : `${packageDir}/package.json`;
    const violations = findViolations(packageDir, collectDependencies(pkg));

    if (violations.length > 0) {
      hasViolations = true;
      console.error(`❌ ${label} contains prohibited dependencies: ${violations.join(", ")}`);
    } else {
      console.log(`✅ ${label} — no prohibited dependencies`);
    }
  }

  if (hasViolations) {
    console.error("\n Capability guard failed: out-of-scope dependencies detected.");
    console.error(" Remove them before merging this change.\n");
    process.exit(1);
  }

  console.log(
    `\n✅ Dependency guard passed — ${packageDirs.length} workspace packages checked, ` +
      "no prohibited packages found.",
  );
}

const isMain =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) main();