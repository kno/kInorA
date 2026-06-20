#!/usr/bin/env node

/**
 * Dependency guard — ensures no out-of-scope packages are present.
 *
 * Prohibited categories per the 01a spec:
 *   DB drivers, auth, Stripe, AI, Docker, CI/CD, PWA, Capacitor
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
const PROHIBITED_PATTERNS = [
  // Database drivers
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
  // Authentication
  /auth\.js/i,
  /next-auth/i,
  /passport/i,
  /oauth/i,
  /bcrypt/i,
  /argon2/i,
  // Payments
  /stripe/i,
  // AI
  /openai/i,
  /@ai-sdk/i,
  /ai-sdk/i,
  /langchain/i,
  // Docker
  /docker/i,
  /dockerode/i,
  // CI/CD
  /github-actions/i,
  // PWA
  /workbox/i,
  /next-pwa/i,
  // Capacitor/native
  /@capacitor/i,
  /capacitor/i,
];

const WORKSPACE_PACKAGE_FILES = [
  join(ROOT, "apps/web/package.json"),
  join(ROOT, "apps/api/package.json"),
  join(ROOT, "packages/contracts/package.json"),
];

function collectDependencies(pkg) {
  const deps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ];
  return deps;
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
    for (const pattern of PROHIBITED_PATTERNS) {
      if (pattern.test(dep)) {
        violations.push(dep);
        break;
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