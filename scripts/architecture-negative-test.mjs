#!/usr/bin/env node

/**
 * Architecture negative guard — proves the dependency-cruiser rules reject
 * database package imports from inner layers that MUST stay free of persistence
 * dependencies.
 *
 * Writes a temporary violating probe file inside the layer's src directory,
 * runs `depcruise` against it, and asserts that depcruise reports violations.
 * Cleans up the probe file before exiting (even on failure).
 *
 * Coverage:
 *   - packages/contracts/src MUST reject `pg` import (contracts-no-outer-npm-unresolvable).
 *   - packages/domain/src MUST reject `drizzle-orm` import (domain-no-outer-npm-unresolvable).
 *
 * Exit codes:
 *   0 — every violation was rejected as expected.
 *   1 — at least one violation was silently accepted (guard regression).
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const DEPCRUISE = join(ROOT, "node_modules", ".bin", "depcruise");
const CONFIG = join(ROOT, ".dependency-cruiser.cjs");

const PROBES = [
  {
    name: "packages/contracts/src rejects pg import",
    dir: join(ROOT, "packages/contracts/src"),
    body: 'import pg from "pg";\nexport const _probe = pg;\n',
    probeFile: "__arch-negative-probe.ts",
    mustMatch: /contracts-no-outer-npm-unresolvable|contracts-no-db-packages/,
  },
  {
    name: "packages/domain/src rejects drizzle-orm import",
    dir: join(ROOT, "packages/domain/src"),
    body: 'import { drizzle } from "drizzle-orm";\nexport const _probe = drizzle;\n',
    probeFile: "__arch-negative-probe.ts",
    mustMatch: /domain-no-outer-npm-unresolvable|domain-no-outer-npm-deps/,
  },
];

let failures = 0;

for (const probe of PROBES) {
  const probePath = join(probe.dir, probe.probeFile);
  writeFileSync(probePath, probe.body, "utf-8");

  let result;
  try {
    result = spawnSync(DEPCRUISE, ["--config", CONFIG, probe.dir], {
      cwd: ROOT,
      encoding: "utf-8",
    });
  } finally {
    rmSync(probePath, { force: true });
  }

  const combined = `${result?.stdout ?? ""}${result?.stderr ?? ""}`;
  const rejected = (result?.status ?? 0) !== 0 && probe.mustMatch.test(combined);

  if (rejected) {
    console.log(`✅ ${probe.name}: rejected by architecture guard.`);
  } else {
    failures += 1;
    console.error(`❌ ${probe.name}: NOT rejected.`);
    console.error(`   exit=${result?.status}, output:\n${combined}`);
  }
}

if (failures > 0) {
  console.error(
    `\n❌ Architecture negative guard failed: ${failures} probe(s) not rejected.`
  );
  process.exit(1);
}

console.log(
  "\n✅ Architecture negative guard passed: every DB import probe was rejected."
);