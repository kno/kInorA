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
 *   - Auth, Stripe, Docker, CI/CD: BLOCKED everywhere
 *
 * Exits 0 if clean, 1 with a descriptive error listing any violations.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

// Packages that MUST NOT appear in any workspace dependency list.
const PROHIBITED_EVERYWHERE = [
  // Authentication
  /auth\.js/i,
  /next-auth/i,
  /passport/i,
  /oauth/i,
  /bcrypt/i,
  /argon2/i,
  // Payments
  /stripe/i,
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
// "ROOT" denotes the repository root package.json (native shell lives at root).
const CAPACITOR_ALLOWED_WORKSPACES = ["apps/mobile", "ROOT"];

// Full list of workspace package files to check (includes root + mobile so
// the scoped allowlists are enforced across the whole monorepo).
const WORKSPACE_PACKAGE_FILES = [
  join(ROOT, "package.json"),
  join(ROOT, "apps/web/package.json"),
  join(ROOT, "apps/api/package.json"),
  join(ROOT, "apps/mobile/package.json"),
  join(ROOT, "packages/contracts/package.json"),
  join(ROOT, "packages/domain/package.json"),
];

function isAllowedWorkspace(filepath, allowedWorkspaces) {
  return allowedWorkspaces.some((allowed) => {
    if (allowed === "ROOT") return filepath === join(ROOT, "package.json");
    return filepath.includes(allowed);
  });
}

function collectDependencies(pkg) {
  return [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ];
}

let hasViolations = false;

for (const filePath of WORKSPACE_PACKAGE_FILES) {
  let pkg;
  try {
    const raw = readFileSync(filePath, "utf-8");
    pkg = JSON.parse(raw);
  } catch {
    console.error(`⚠️  Could not read ${filePath}`);
    process.exit(1);
  }

  const allDeps = collectDependencies(pkg);
  const violations = [];

  for (const dep of allDeps) {
    // Check globally prohibited packages
    for (const pattern of PROHIBITED_EVERYWHERE) {
      if (pattern.test(dep)) {
        violations.push(dep);
        break;
      }
    }

    // Check DB packages — prohibited unless in an allowed workspace
    if (!isAllowedWorkspace(filePath, DB_ALLOWED_WORKSPACES)) {
      for (const pattern of DB_PATTERNS) {
        if (pattern.test(dep)) {
          violations.push(dep);
          break;
        }
      }
    }

    // Check AI/LLM packages — prohibited unless in an allowed workspace
    if (!isAllowedWorkspace(filePath, AI_ALLOWED_WORKSPACES)) {
      for (const pattern of AI_PATTERNS) {
        if (pattern.test(dep)) {
          violations.push(dep);
          break;
        }
      }
    }

    // Check PWA packages — prohibited unless in an allowed workspace
    if (!isAllowedWorkspace(filePath, PWA_ALLOWED_WORKSPACES)) {
      for (const pattern of PWA_PATTERNS) {
        if (pattern.test(dep)) {
          violations.push(dep);
          break;
        }
      }
    }

    // Check Capacitor/native packages — prohibited unless in an allowed workspace
    if (!isAllowedWorkspace(filePath, CAPACITOR_ALLOWED_WORKSPACES)) {
      for (const pattern of CAPACITOR_PATTERNS) {
        if (pattern.test(dep)) {
          violations.push(dep);
          break;
        }
      }
    }
  }

  if (violations.length > 0) {
    hasViolations = true;
    const relPath = filePath.replace(ROOT + "/", "");
    console.error(
      `❌ ${relPath} contains prohibited dependencies: ${violations.join(", ")}`
    );
  } else {
    const relPath = filePath.replace(ROOT + "/", "");
    console.log(`✅ ${relPath} — no prohibited dependencies`);
  }
}

if (hasViolations) {
  console.error(
    "\n Capability guard failed: out-of-scope dependencies detected."
  );
  console.error(
    " Remove them before merging this change.\n"
  );
  process.exit(1);
}

console.log("\n✅ Dependency guard passed — no prohibited packages found.");