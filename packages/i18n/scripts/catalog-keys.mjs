/**
 * Shared helpers for the catalog-key manifest.
 *
 * Kept in `scripts/` (not `src/`) because both the sync script and the guard
 * test consume them, and neither ships in the package's public surface.
 */
import { readFileSync } from "node:fs";

/** Flattens a nested catalog into sorted, dot-joined leaf keys. */
export function leafKeys(nested, prefix = "") {
  const keys = [];

  for (const [key, value] of Object.entries(nested)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      keys.push(path);
    } else {
      keys.push(...leafKeys(value, path));
    }
  }

  return prefix ? keys : keys.sort();
}

export const CATALOG_PATH = new URL("../src/messages/en.json", import.meta.url);
export const MANIFEST_PATH = new URL("../catalog-keys.txt", import.meta.url);

/** The keys the shipped EN catalog actually carries, sorted. */
export function catalogKeys() {
  return leafKeys(JSON.parse(readFileSync(CATALOG_PATH, "utf8")));
}

/** The keys the checked-in manifest claims, in file order. */
export function manifestKeys() {
  return readFileSync(MANIFEST_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function renderManifest(keys) {
  return `${[
    "# Every leaf key the EN catalog ships, one per line, sorted.",
    "#",
    "# This file is the merge-safe replacement for the frozen key TOTAL that used",
    "# to live on a single line of src/__tests__/index.test.ts. A number forces",
    "# every branch through the same line and has a resolution that is green and",
    "# wrong; a sorted list of names does not, because two branches adding keys in",
    "# different places merge without touching each other, and a resolution that",
    "# drops one side's keys leaves this file disagreeing with the catalog.",
    "#",
    "# Regenerate with `pnpm --filter @kinora/i18n keys:sync`, then READ THE DIFF:",
    "# every line it adds or removes is a key you are shipping or deleting.",
    "",
    ...keys,
  ].join("\n")}\n`;
}
