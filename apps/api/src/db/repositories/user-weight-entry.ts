import { asc, count, desc, eq, sql } from "drizzle-orm";
import { userWeightEntries } from "../schema.js";
import type { Database } from "../client.js";
import type { CreateWeightEntryResponse, WeightEntryDTO } from "@kinora/contracts";

/** Cap on `GET /weight-entries` — matches the design's bounded-list contract. */
const LIST_LIMIT = 100;

/** One weight-entry row as read from persistence (`weight_kg` is `numeric`, reads back as `string`). */
interface UserWeightEntryRow {
  id: string;
  userId: string;
  weightKg: string;
  recordedAt: Date;
  createdAt: Date;
}

/** One reading as consumed by the (PR 4) bodyweight-resolution function — no id, weight + instant only. */
export interface BodyweightSeriesEntry {
  weightKg: number;
  recordedAt: string;
}

function toDTO(row: UserWeightEntryRow): WeightEntryDTO {
  return {
    id: row.id,
    weightKg: Number(row.weightKg),
    recordedAt: row.recordedAt.toISOString(),
  };
}

/**
 * Bodyweight-series persistence repository (17c-profile-body-metrics, PR 2).
 *
 * Deliberately NO unique index on `userId` — this is a 1:many series, unlike
 * `UserProfileRepository`. `insert` computes `wasFirstEntry` INSIDE the same
 * transaction as the write, serialized by a per-user Postgres advisory lock
 * (`pg_advisory_xact_lock(hashtext(userId))`, mirroring the
 * `SeatSyncStore`/`TierOverrideAdminRepository` pattern) so two concurrent
 * first-ever inserts for the same user cannot both observe `count = 1` and
 * both report `wasFirstEntry: true`.
 */
export class UserWeightEntryRepository {
  constructor(private db: Database) {}

  /**
   * The authenticated user's own entries, newest `recordedAt` first, capped
   * at {@link LIST_LIMIT}. User isolation is enforced by the single-column
   * `userId` predicate — there is no way to read another user's entries
   * without passing their `userId`.
   */
  async list(userId: string): Promise<WeightEntryDTO[]> {
    const rows = (await this.db
      .select()
      .from(userWeightEntries)
      .where(eq(userWeightEntries.userId, userId))
      .orderBy(desc(userWeightEntries.recordedAt))
      .limit(LIST_LIMIT)) as UserWeightEntryRow[];
    return rows.map(toDTO);
  }

  /**
   * Insert one entry and report whether it was the user's first-ever
   * reading. The advisory lock is held for the whole transaction (insert +
   * count), so a raced second insert for the same user always observes the
   * winner's committed row before computing its own count.
   */
  async insert(
    userId: string,
    input: { weightKg: number; recordedAt?: string },
  ): Promise<CreateWeightEntryResponse> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

      const [row] = (await tx
        .insert(userWeightEntries)
        .values({
          userId,
          weightKg: String(input.weightKg),
          recordedAt: input.recordedAt ? new Date(input.recordedAt) : undefined,
        })
        .returning()) as UserWeightEntryRow[];

      const [countRow] = (await tx
        .select({ count: count() })
        .from(userWeightEntries)
        .where(eq(userWeightEntries.userId, userId))) as { count: number }[];

      return { entry: toDTO(row!), wasFirstEntry: countRow!.count === 1 };
    });
  }

  /**
   * The user's FULL series, ascending by `recordedAt`, unbounded — feeds the
   * PR 4 `resolveBodyweightForSession` batched read (one query per
   * stats/history call, no per-session I/O).
   */
  async listAllForUser(userId: string): Promise<BodyweightSeriesEntry[]> {
    const rows = (await this.db
      .select()
      .from(userWeightEntries)
      .where(eq(userWeightEntries.userId, userId))
      .orderBy(asc(userWeightEntries.recordedAt))) as UserWeightEntryRow[];
    return rows.map((row) => ({
      weightKg: Number(row.weightKg),
      recordedAt: row.recordedAt.toISOString(),
    }));
  }
}
