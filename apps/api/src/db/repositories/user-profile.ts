import { eq } from "drizzle-orm";
import { userProfiles } from "../schema.js";
import type { Database } from "../client.js";
import type { ExperienceLevel, PlanGoal } from "@kinora/contracts";

/**
 * User profile record as read from persistence. Mirrors the `user_profiles`
 * row shape including timestamps — the lean contract `UserProfile` (no
 * timestamps) is produced by the service layer from this record.
 */
export interface UserProfileRecord {
  userId: string;
  name: string;
  goal: PlanGoal | null;
  experienceLevel: ExperienceLevel | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Data required to upsert a user profile row.
 *
 * `goal` and `experienceLevel` are nullable: `null` is a WRITE intent
 * ("the user has not chosen a goal") distinct from `undefined`, which the
 * route layer translates to "leave the stored value unchanged". The
 * repository always persists whatever it receives — partial-merge happens
 * at the route/service boundary, never here.
 *
 * `name` is required: the table column is NOT NULL and R2 rejects blank
 * names with 422; the repo trusts that the caller has already validated.
 */
export interface UserProfileUpsertInput {
  name: string;
  goal: PlanGoal | null;
  experienceLevel: ExperienceLevel | null;
}

/**
 * User Profile persistence repository (10a-user-profile).
 *
 * One row per user, enforced by the unique index on `userId`. `upsert` uses
 * ON CONFLICT (userId) DO UPDATE so first-write and subsequent writes share
 * one atomic path — no separate read-modify-write cycle that could race on
 * the auto-provision flow.
 */
export class UserProfileRepository {
  constructor(private db: Database) {}

  /**
   * Return the profile row owned by `userId`, or `null` when none exists.
   *
   * The table is keyed by `userId` (unique) and carries no tenant column:
   * user isolation is enforced by this single-column predicate. There is
   * no way to read another user's profile without passing their `userId`.
   */
  async findByUserId(userId: string): Promise<UserProfileRecord | null> {
    const rows = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return (rows[0] as UserProfileRecord | undefined) ?? null;
  }

  /**
   * Insert or update the profile row for `userId`.
   *
   * The caller supplies the FULL target state (name, goal, experienceLevel);
   * partial-merge lives at the route/service boundary, not here. On
   * conflict the supplied fields overwrite the stored ones, and
   * `updatedAt` is bumped server-side via `SQL now()`.
   */
  async upsert(
    userId: string,
    input: UserProfileUpsertInput
  ): Promise<UserProfileRecord> {
    const rows = await this.db
      .insert(userProfiles)
      .values({
        userId,
        name: input.name,
        goal: input.goal,
        experienceLevel: input.experienceLevel,
      })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          name: input.name,
          goal: input.goal,
          experienceLevel: input.experienceLevel,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0] as UserProfileRecord;
  }

  /** Insert the default row without overwriting a concurrent PUT. */
  async createIfMissing(
    userId: string,
    input: UserProfileUpsertInput
  ): Promise<void> {
    await this.db
      .insert(userProfiles)
      .values({
        userId,
        name: input.name,
        goal: input.goal,
        experienceLevel: input.experienceLevel,
      })
      .onConflictDoNothing({ target: userProfiles.userId });
  }
}
