/**
 * Structural guard: no integration suite may empty a shared table (#405).
 *
 * Every `*.integration.test.ts` runs against ONE scratch database, and vitest
 * runs test files in parallel workers. An unscoped `db.delete(table)` therefore
 * deletes rows a concurrently-running suite has already read and is about to
 * re-read. That is not a hypothetical: `observability-events` used to wipe
 * `observability_events` in `beforeEach`, which made `admin-stats`'s 24-hour
 * window assertion fail intermittently on a required check — its `after` count
 * came back LOWER than its `before` count.
 *
 * A wipe is not isolation anyway: another worker can insert between the delete
 * and the read. The isolation that actually holds is a PRIVATE scope — a random
 * tenant id, a private cohort week, a unique event name — so this guard forbids
 * the wipe rather than trying to schedule around it.
 *
 * Hermetic: reads the suite sources off disk, needs no database, and so runs in
 * the `ci` job on every PR rather than only where Postgres is wired.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const API_SRC = new URL("../../", import.meta.url).pathname;

function integrationSuites(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      found.push(...integrationSuites(path));
    } else if (entry.name.endsWith(".integration.test.ts")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * A `.delete(<table>)` NOT followed by `.where(`. Drizzle's builder is chained,
 * so an unscoped delete is exactly that. Matched against the whole file rather
 * than line by line: the formatter renders the scoped form as
 * `.delete(table)\n  .where(...)`, and `\s*` spans the newline.
 */
const UNSCOPED_DELETE = /\.delete\(\s*[A-Za-z_$][\w$]*\s*\)(?!\s*\.where\()/g;

describe("integration suite isolation", () => {
  const suites = integrationSuites(API_SRC);

  it("finds the integration suites it is meant to guard", () => {
    // Fails loudly if the directory layout moves and this guard silently starts
    // checking nothing — the false-green shape #382 was about.
    expect(suites.length).toBeGreaterThan(10);
  });

  it("no integration suite deletes from a shared table without a WHERE clause", () => {
    const offenders: string[] = [];
    for (const suite of suites) {
      const source = readFileSync(suite, "utf8");
      for (const match of source.matchAll(UNSCOPED_DELETE)) {
        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${suite}:${line}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
