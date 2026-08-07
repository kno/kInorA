/**
 * Real-Postgres integration coverage for `UserWeightEntryRepository`
 * (17c-profile-body-metrics, PR 2).
 *
 * Three properties only a real Postgres can prove:
 *   1. Two readings coexist for one user — the table carries NO unique index
 *      on `userId` (unlike `UserProfileRepository`).
 *   2. Deleting the user cascades every `user_weight_entries` row away
 *      (`ON DELETE CASCADE`).
 *   3. `wasFirstEntry` is computed INSIDE the insert transaction, serialized
 *      by the per-user advisory lock — two concurrent first-ever inserts for
 *      the SAME user (raced via `Promise.all`) can never both report
 *      `wasFirstEntry: true`. The mocked unit suite cannot prove this: it
 *      cannot model two real transactions racing each other.
 *
 * Opt-in via `DATABASE_URL` (podman pgvector:pg17 harness, same pattern as
 * the other billing/db integration suites) — skipped when no real Postgres
 * is wired so the default `vitest run` stays hermetic.
 *
 * MUST be added to the real-Postgres CI job's hardcoded file list
 * (`.github/workflows/ci-cd.yml`) in the SAME commit as this file — otherwise
 * this proof never runs anywhere (#382).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDbClient } from "../../client.js";
import { userWeightEntries, users } from "../../schema.js";
import { UserWeightEntryRepository } from "../user-weight-entry.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("UserWeightEntryRepository (real Postgres)", () => {
  const { db, pool } = createDbClient();
  const repo = new UserWeightEntryRepository(db);

  afterAll(async () => {
    await pool.end();
  });

  function uniqueEmail(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random()}@example.com`;
  }

  async function seedUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("weight-entry") })
      .returning({ id: users.id });
    return user!.id;
  }

  it("allows two readings to coexist for one user (no unique index on userId)", async () => {
    const userId = await seedUser();

    await repo.insert(userId, { weightKg: 80, recordedAt: "2026-06-01T00:00:00.000Z" });
    await repo.insert(userId, { weightKg: 78, recordedAt: "2026-07-01T00:00:00.000Z" });

    const rows = await db
      .select()
      .from(userWeightEntries)
      .where(eq(userWeightEntries.userId, userId));
    expect(rows).toHaveLength(2);
  });

  it("GET (list) returns entries newest-recordedAt-first", async () => {
    const userId = await seedUser();

    await repo.insert(userId, { weightKg: 80, recordedAt: "2026-06-01T00:00:00.000Z" });
    await repo.insert(userId, { weightKg: 79, recordedAt: "2026-08-01T00:00:00.000Z" });
    await repo.insert(userId, { weightKg: 78, recordedAt: "2026-07-01T00:00:00.000Z" });

    const entries = await repo.list(userId);

    expect(entries.map((e) => e.weightKg)).toEqual([79, 78, 80]);
  });

  it("deleting the user cascades every user_weight_entries row away", async () => {
    const userId = await seedUser();
    await repo.insert(userId, { weightKg: 72.5 });
    await repo.insert(userId, { weightKg: 73 });

    await db.delete(users).where(eq(users.id, userId));

    const rows = await db
      .select()
      .from(userWeightEntries)
      .where(eq(userWeightEntries.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("wasFirstEntry cannot fire twice for two concurrent first-ever inserts (raced)", async () => {
    const userId = await seedUser();

    const [resultA, resultB] = await Promise.all([
      repo.insert(userId, { weightKg: 80 }),
      repo.insert(userId, { weightKg: 82 }),
    ]);

    // Exactly one of the two raced inserts observed count === 1.
    const firstFlags = [resultA.wasFirstEntry, resultB.wasFirstEntry];
    expect(firstFlags.filter(Boolean)).toHaveLength(1);

    const rows = await db
      .select()
      .from(userWeightEntries)
      .where(eq(userWeightEntries.userId, userId));
    expect(rows).toHaveLength(2);
  });
});

describe.skipIf(hasDb)("UserWeightEntryRepository (real Postgres) — skipped", () => {
  it("requires DATABASE_URL (podman pgvector:pg17 harness) to run", () => {
    expect(hasDb).toBe(false);
  });
});
