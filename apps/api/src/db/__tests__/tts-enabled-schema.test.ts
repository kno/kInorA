import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A3 (13-v1.1-interactive-voice-chat): the ONLY schema change is an additive,
 * nullable `tts_enabled` column on `user_preferences`. This test pins the
 * migration file + journal entry so the additive, zero-risk property is guarded
 * (mirrors `stripe-schema.test.ts`). Column shape is asserted separately in
 * `user-preferences-schema.test.ts`.
 */
const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0014_tts_enabled.sql", import.meta.url)),
  "utf8",
);

const migrationJournal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("tts_enabled migration (13 A3)", () => {
  it("adds the nullable tts_enabled column additively (no destructive DDL)", () => {
    expect(migrationSql).toContain('ALTER TABLE "user_preferences" ADD COLUMN "tts_enabled" boolean');
    // Additive only — no drops, no NOT NULL, no backfill/default that could
    // touch existing rows.
    expect(migrationSql).not.toContain("DROP");
    expect(migrationSql).not.toContain("NOT NULL");
    expect(migrationSql).not.toContain("DEFAULT");
  });

  it("registers the migration as a journal entry appended after 0013 with a monotonic timestamp", () => {
    const entry = migrationJournal.entries.find((e) => e.tag === "0014_tts_enabled");
    expect(entry).toBeDefined();
    // Appended directly after 0013_stripe_event_ts. (No longer the highest idx —
    // 0015_plan_draft_version was appended after it; see plan-draft-version-schema.test.ts.)
    const prior = migrationJournal.entries.find((e) => e.idx === entry!.idx - 1);
    expect(prior).toBeDefined();
    expect(prior!.tag).toBe("0013_stripe_event_ts");
    expect(entry!.when).toBeGreaterThan(prior!.when);
  });
});
