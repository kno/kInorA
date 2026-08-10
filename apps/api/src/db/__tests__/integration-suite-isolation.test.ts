/**
 * Structural guard: no integration suite may empty OR count a shared table
 * (#405).
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
 * The unscoped whole-table READ is the same defect seen from the other side.
 * `workout-session` counted all of `set_records` and `session_exercises` before
 * and after an auto-close and asserted an exact delta; three rows from a
 * concurrent worker turned that into `expected 17 to be 14`. Reading everything
 * and filtering in JavaScript has the same hole, because the rows that arrive
 * between the two reads are indistinguishable from the ones under test. Scope
 * the read in SQL instead — join through to the owning tenant/user row when the
 * table carries no scope column of its own.
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

/**
 * A drizzle `.from(<table>)` that never narrows — no `.where(`, and no join
 * that would carry a `.where(` of its own further down the chain.
 *
 * Anchored on the closing paren of the preceding builder call (`db.select()`,
 * `.select({ ... })`), which is what makes this safe to run over whole files:
 * without that anchor a plain `.from(` also matches `Array.from(rows)`, and a
 * guard that misfires on ordinary JavaScript would be worse than no guard.
 * The join keywords are allowed through because joining and then filtering is
 * the only way to scope a table that carries no tenant/user column of its own
 * (`set_records` reaches its owner through `session_exercises`).
 */
const UNSCOPED_READ =
  /\)\s*\.from\(\s*[A-Za-z_$][\w$]*\s*\)(?!\s*\.(?:where|innerJoin|leftJoin|rightJoin|fullJoin)\()/g;

describe("integration suite isolation", () => {
  const suites = integrationSuites(API_SRC);

  it("finds the integration suites it is meant to guard", () => {
    // Fails loudly if the directory layout moves and this guard silently starts
    // checking nothing — the false-green shape #382 was about.
    expect(suites.length).toBeGreaterThan(10);
  });

  function offenders(pattern: RegExp): string[] {
    const found: string[] = [];
    for (const suite of suites) {
      const source = readFileSync(suite, "utf8");
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        found.push(`${suite}:${line}: ${match[0].trim()}`);
      }
    }
    return found;
  }

  it("no integration suite deletes from a shared table without a WHERE clause", () => {
    expect(offenders(UNSCOPED_DELETE)).toEqual([]);
  });

  it("no integration suite reads a shared table without a WHERE clause", () => {
    expect(offenders(UNSCOPED_READ)).toEqual([]);
  });

  it("the read pattern does not fire on ordinary JavaScript that happens to call .from", () => {
    // `Array.from(rows)` is `.from(<identifier>)` too. Two suites already build
    // fixtures with `Array.from`, so a guard that flagged it would block every
    // PR touching them. Pinned here so the anchor is never "simplified" away.
    expect("const list = Array.from(rows);".match(UNSCOPED_READ)).toBeNull();
    expect("await db.select().from(setRecords);".match(UNSCOPED_READ)).not.toBeNull();
  });
});
