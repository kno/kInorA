#!/usr/bin/env node
/**
 * Regenerates `catalog-keys.txt` from the shipped EN catalog.
 *
 * Run it after adding or removing catalog keys, and review the resulting diff:
 * it names every key that appeared or disappeared. Never run it to "make the
 * suite green" after a merge without reading what it removed — a merge that
 * discarded another branch's keys shows up here as deletions.
 */
import { writeFileSync } from "node:fs";
import { catalogKeys, manifestKeys, MANIFEST_PATH, renderManifest } from "./catalog-keys.mjs";

const before = (() => {
  try {
    return manifestKeys();
  } catch {
    return [];
  }
})();

const after = catalogKeys();
writeFileSync(MANIFEST_PATH, renderManifest(after));

const added = after.filter((key) => !before.includes(key));
const removed = before.filter((key) => !after.includes(key));

console.log(`catalog-keys.txt: ${after.length} keys (+${added.length} / -${removed.length})`);
for (const key of added) console.log(`  + ${key}`);
for (const key of removed) console.log(`  - ${key}`);
