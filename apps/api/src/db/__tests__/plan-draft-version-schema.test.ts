import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #215: the ONLY schema change is an additive `version` integer column on
 * `plan_drafts`, added with a server default of 0 so every existing row
 * back-fills safely. This test pins the migration file + journal entry so the
 * additive, non-destructive property is guarded (mirrors `tts-enabled-schema.test.ts`).
 * Column shape is asserted separately in `plan-schema.test.ts`.
 */
const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0015_plan_draft_version.sql", import.meta.url)),
  "utf8",
);

const migrationJournal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("plan_drafts version migration (#215)", () => {
  it("adds the version column additively with a default backfill (no destructive DDL)", () => {
    expect(migrationSql).toContain('ALTER TABLE "plan_drafts" ADD COLUMN "version" integer');
    // NOT NULL is allowed here ONLY because it is paired with a DEFAULT, which
    // back-fills existing rows — so it is still additive and safe.
    expect(migrationSql).toContain("DEFAULT 0");
    expect(migrationSql).toContain("NOT NULL");
    // Never destructive.
    expect(migrationSql).not.toContain("DROP");
  });

  it("registers the migration at idx 15, appended after 0014_tts_enabled with a monotonic timestamp", () => {
    const entry = migrationJournal.entries.find((e) => e.tag === "0015_plan_draft_version");
    expect(entry).toBeDefined();
    // Fixed position — later migrations (15a-v2-trainer-account-access) are
    // appended after this one, so idx 15 is no longer necessarily the max.
    expect(entry!.idx).toBe(15);
    const prior = migrationJournal.entries.find((e) => e.idx === entry!.idx - 1);
    expect(prior).toBeDefined();
    expect(entry!.when).toBeGreaterThan(prior!.when);
  });
});
