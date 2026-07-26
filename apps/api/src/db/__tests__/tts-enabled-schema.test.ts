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

  it("registers the migration as the latest journal entry with a monotonic timestamp", () => {
    const entry = migrationJournal.entries.find((e) => e.tag === "0014_tts_enabled");
    expect(entry).toBeDefined();
    // Highest idx — appended after 0013_stripe_event_ts.
    const maxIdx = Math.max(...migrationJournal.entries.map((e) => e.idx));
    expect(entry!.idx).toBe(maxIdx);
    const prior = migrationJournal.entries.find((e) => e.idx === entry!.idx - 1);
    expect(prior).toBeDefined();
    expect(entry!.when).toBeGreaterThan(prior!.when);
  });
});
