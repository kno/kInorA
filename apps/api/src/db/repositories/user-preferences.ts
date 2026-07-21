import { eq } from "drizzle-orm";
import { userPreferences } from "../schema.js";
import type { Database } from "../client.js";

/**
 * User preferences record as read from persistence. Mirrors the
 * `user_preferences` row shape including timestamps — the lean contract
 * `UserPreferences` (no timestamps) is produced by the service layer.
 */
export interface UserPreferencesRecord {
  userId: string;
  defaultLocation: string | null;
  defaultDuration: number | null;
  defaultEquipment: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Partial input for upsert. Every field is OPTIONAL and NULLABLE:
 *   - field absent  → on UPDATE leave the stored value unchanged (partial
 *                     merge); on INSERT the column defaults to NULL.
 *   - field present with `null` → write NULL (explicit "unset").
 *   - field present with a value → write that value.
 *
 * The contract `UpdatePreferencesRequest` carries the user-facing partial
 * shape; this type adds the `null`-as-write-intent distinction so the route
 * can forward "unset this preference" through the same code path.
 */
export interface UserPreferencesUpsertInput {
  defaultLocation?: string | null;
  defaultDuration?: number | null;
  defaultEquipment?: string[] | null;
}

/**
 * User Preferences persistence repository (10b-user-preferences).
 *
 * One row per user, keyed by the unique index on `userId`. The repo
 * enforces TWO invariants:
 *   1. Partial merge: absent fields MUST NOT appear in the ON CONFLICT SET
 *      clause (so the stored value is preserved). This is why the SET
 *      object is built dynamically from `Object.keys(input)`, not spread.
 *   2. Positive duration: `defaultDuration`, when non-null, MUST be a
 *      positive integer. Postgres cannot express "positive integer"
 *      declaratively, so this guard lives at the persistence boundary as
 *      defense in depth under the route's own 422 validation (R2).
 */
export class UserPreferencesRepository {
  constructor(private db: Database) {}

  /**
   * Return the preferences row owned by `userId`, or `null` when none exists.
   * User-scoped table → isolation is enforced by the single-column predicate.
   */
  async findByUserId(
    userId: string
  ): Promise<UserPreferencesRecord | null> {
    const rows = await this.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return (rows[0] as UserPreferencesRecord | undefined) ?? null;
  }

  /**
   * Insert or partially update the preferences row for `userId`.
   *
   * - INSERT path: un-sent fields default to NULL (additive first-write).
   * - ON CONFLICT path: the SET object contains ONLY sent fields + `updatedAt`.
   *   Absent keys are not present → the columns are untouched on UPDATE.
   *
   * Throws when a non-positive `defaultDuration` is supplied — the unique
   * invariant that the route layer also enforces with 422.
   */
  async upsert(
    userId: string,
    input: UserPreferencesUpsertInput
  ): Promise<UserPreferencesRecord> {
    if (
      "defaultDuration" in input &&
      input.defaultDuration !== null &&
      input.defaultDuration !== undefined &&
      input.defaultDuration <= 0
    ) {
      throw new Error(
        "defaultDuration MUST be a positive integer (got " +
          String(input.defaultDuration) +
          ")"
      );
    }

    // Build the SET object dynamically — ONLY sent fields enter the clause.
    // This is the literal mechanism that implements partial merge; spreading
    // the input directly would include `undefined` values and overwrite
    // stored data with NULL. `$inferInsert` is Drizzle's typed insert shape;
    // all columns except the NOT NULL `userId` are optional here.
    type PreferencesInsert = typeof userPreferences.$inferInsert;
    const set: Partial<PreferencesInsert> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if ("defaultLocation" in input) {
      set.defaultLocation = input.defaultLocation ?? null;
    }
    if ("defaultDuration" in input) {
      set.defaultDuration = input.defaultDuration ?? null;
    }
    if ("defaultEquipment" in input) {
      set.defaultEquipment = input.defaultEquipment ?? null;
    }

    // INSERT values: un-sent columns are simply absent (default NULL).
    const values: PreferencesInsert = { userId };
    if ("defaultLocation" in input) {
      values.defaultLocation = input.defaultLocation ?? null;
    }
    if ("defaultDuration" in input) {
      values.defaultDuration = input.defaultDuration ?? null;
    }
    if ("defaultEquipment" in input) {
      values.defaultEquipment = input.defaultEquipment ?? null;
    }

    const rows = await this.db
      .insert(userPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set,
      })
      .returning();
    return rows[0] as UserPreferencesRecord;
  }
}