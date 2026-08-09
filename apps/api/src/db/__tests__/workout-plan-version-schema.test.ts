import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #421: the ONLY schema change is an additive `version` integer column on
 * `workout_plans`, added with a server default of 1 so every existing row
 * back-fills safely.
 *
 * Mirrors `plan-draft-version-schema.test.ts` deliberately — this column is the
 * same idea applied to the same problem: an optimistic-concurrency token that
 * must be a monotonic counter rather than a timestamp, because a timestamp
 * makes clock precision a correctness property (see
 * `WorkoutPlanRepository.updateProgram`).
 */
const migrationSql = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0030_workout_plan_version.sql", import.meta.url)),
  "utf8",
);

const migrationJournal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../drizzle/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("workout_plans version migration (#421)", () => {
  it("adds the version column additively with a default backfill (no destructive DDL)", () => {
    expect(migrationSql).toContain('ALTER TABLE "workout_plans" ADD COLUMN "version" integer');
    // NOT NULL is allowed here ONLY because it is paired with a DEFAULT, which
    // back-fills existing rows — so it is still additive and safe.
    expect(migrationSql).toContain("DEFAULT 1");
    expect(migrationSql).toContain("NOT NULL");
    // Never destructive: `updated_at` stays exactly where it is. It loses its
    // concurrency role, not its data.
    expect(migrationSql).not.toContain("DROP");
  });

  it("registers the migration at idx 30 with a timestamp after its predecessor", () => {
    const entry = migrationJournal.entries.find((e) => e.tag === "0030_workout_plan_version");
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(30);
    const prior = migrationJournal.entries.find((e) => e.idx === entry!.idx - 1);
    expect(prior).toBeDefined();
    expect(entry!.when).toBeGreaterThan(prior!.when);
  });
});
