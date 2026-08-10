import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogs, flattenMessages } from "../index.js";

/**
 * The catalog-key manifest guard.
 *
 * This replaces the frozen whole-catalog TOTAL that used to sit on a single
 * line of `index.test.ts` (kno/kInorA#428). That number was the one line every
 * concurrent branch had to edit, so every branch conflicted there — and the
 * conflict had a resolution that was green and WRONG: take either side and the
 * suite passed, because the number now matched whichever catalog survived the
 * merge. The other side's keys were gone with nothing reporting it. It happened:
 * the value moved 805 -> 807 -> 813 -> 797 -> 754 across five branches in about
 * a day, each move a hand-resolved conflict, and one of them silently discarded
 * two `mobileTracker.*` keys.
 *
 * The manifest fixes the failure mode at its root: there is no aggregate to
 * hand-compute, and no single line every branch has to edit.
 *
 * - Two branches adding keys in different namespaces touch different regions of
 *   a sorted list, so they merge with no conflict at all.
 * - Two branches adding keys next to each other DO conflict — and neither
 *   one-sided resolution is green, because the catalogs themselves merged
 *   cleanly and now carry keys the resolved manifest omits. The failure names
 *   the missing keys.
 * - Regenerating is `pnpm --filter @kinora/i18n keys:sync`, and its diff is a
 *   list of key NAMES: a merge that dropped keys shows up as deletions a
 *   reviewer can see, not as a number that only arithmetic can refute.
 *
 * What this does NOT do, and what still covers it:
 * - EN/ES parity (a key added to EN and not ES) — `validateCatalogParity`,
 *   asserted in `index.test.ts` and `catalog-parity.test.ts`. The manifest is
 *   deliberately EN-derived; duplicating it per locale would just be parity
 *   checked twice.
 * - An orphan key nothing renders, and a key the code renders but the catalog
 *   no longer ships — `catalog-usage.test.ts`, which reconciles the catalog
 *   against real call sites in the web and mobile sources. That is the guard
 *   that holds when a merge is resolved one-sidedly in EVERY file, including
 *   this manifest: the dropped key's call site survives and names it.
 */

const MANIFEST_PATH = new URL("../../catalog-keys.txt", import.meta.url);

function manifestKeys(): string[] {
  return readFileSync(MANIFEST_PATH, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function namespacesOf(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.split(".")[0]!))].sort();
}

describe("catalog key manifest", () => {
  it("lists exactly the keys the EN catalog ships", () => {
    const declared = manifestKeys();
    const shipped = Object.keys(flattenMessages(catalogs.en));

    const declaredSet = new Set(declared);
    const shippedSet = new Set(shipped);

    // Both directions in one assertion so the failure names every drifted key
    // at once. `missingFromCatalog` is the merge-dropped-keys case: the
    // manifest still remembers a key the catalog no longer has.
    expect({
      missingFromCatalog: declared.filter((key) => !shippedSet.has(key)),
      missingFromManifest: shipped.filter((key) => !declaredSet.has(key)),
    }).toEqual({ missingFromCatalog: [], missingFromManifest: [] });
  });

  it("is sorted and free of duplicates, so branches merge by region", () => {
    const declared = manifestKeys();

    expect(declared).toEqual([...declared].sort());
    expect(declared).toEqual([...new Set(declared)]);
  });

  it("keeps every declared namespace present in both catalogs", () => {
    // A whole namespace deleted from both locales passes the parity check —
    // the catalogs still agree with each other. This is the assertion that
    // notices, and it names the namespace rather than moving a total.
    const declaredNamespaces = namespacesOf(manifestKeys());

    expect(namespacesOf(Object.keys(flattenMessages(catalogs.en)))).toEqual(declaredNamespaces);
    expect(namespacesOf(Object.keys(flattenMessages(catalogs.es)))).toEqual(declaredNamespaces);
  });
});
