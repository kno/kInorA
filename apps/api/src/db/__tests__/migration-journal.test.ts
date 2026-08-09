/**
 * Guard test for the Drizzle migration journal (17b-stale-session-recovery).
 *
 * The journal `idx` — not the SQL filename number — is what `drizzle-kit
 * migrate` actually reads to decide which migrations to apply. A migration
 * file with no matching journal entry is SILENTLY SKIPPED on deploy: this has
 * bitten this repo before, and the hand-check it used to rely on is replaced
 * here by an assertion that fails in CI rather than in a reviewer's memory.
 *
 * Two properties are asserted:
 *   1. Every `apps/api/drizzle/*.sql` filename has a matching `tag` entry in
 *      `meta/_journal.json` (no orphaned SQL file).
 *   2. The journal's `idx` values are contiguous starting at 0, with no gaps
 *      and no duplicates (no orphaned journal entry, and no skipped index).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(__dirname, "..", "..", "..", "drizzle");

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

function readJournal(): Journal {
  const raw = readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf-8");
  return JSON.parse(raw) as Journal;
}

function sqlMigrationTags(): string[] {
  return readdirSync(drizzleDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.replace(/\.sql$/, ""))
    .sort();
}

describe("Drizzle migration journal", () => {
  it("has a journal tag entry for every drizzle/*.sql file", () => {
    const journal = readJournal();
    const journalTags = new Set(journal.entries.map((entry) => entry.tag));
    const migrationTags = sqlMigrationTags();

    for (const tag of migrationTags) {
      expect(journalTags.has(tag), `missing journal entry for ${tag}.sql`).toBe(true);
    }
  });

  it("has contiguous journal idx values starting at 0, no gaps, no duplicates", () => {
    const journal = readJournal();
    const idxValues = journal.entries.map((entry) => entry.idx).sort((a, b) => a - b);

    const uniqueIdxValues = new Set(idxValues);
    expect(uniqueIdxValues.size, "duplicate idx values in the journal").toBe(idxValues.length);

    idxValues.forEach((idx, position) => {
      expect(idx, `journal idx is not contiguous from 0 (gap at position ${position})`).toBe(
        position,
      );
    });
  });

  it("includes the 17b abandoned-status migration at idx 26", () => {
    const journal = readJournal();
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0026_workout_session_abandoned_enum",
    );
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(26);
  });

  it("includes the 17c profile body-metrics migration at idx 27", () => {
    const journal = readJournal();
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0027_user_profile_body_metrics",
    );
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(27);
  });

  it("includes the 17c bodyweight-series migration at idx 28", () => {
    const journal = readJournal();
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0028_user_weight_entries",
    );
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(28);
  });

  it("includes the 17d PR B archived_at migration at idx 29", () => {
    // The journal max idx was 28 before this change; `drizzle/` holds 29
    // .sql files (not 28) because 0011 is used twice
    // (0011_billing_plans_tiers.sql and 0011_abnormal_squadron_sinister.sql).
    // The journal idx, not the file count, is authoritative — this pins the
    // correct next value so a future reader does not derive 0030 and leave a gap.
    const journal = readJournal();
    const entry = journal.entries.find(
      (candidate) => candidate.tag === "0029_workout_plan_archived_at",
    );
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(29);
  });
});
