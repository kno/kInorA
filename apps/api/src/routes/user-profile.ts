import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import type {
  UserProfile,
  PlanGoal,
  ExperienceLevel,
} from "@kinora/contracts";

/**
 * Valid enum value sets — MUST mirror the `goalEnum` / `experienceLevelEnum`
 * pgEnums in `apps/api/src/db/schema.ts` and the contract types. Asserted at
 * the route boundary so invalid client input is rejected with 422 before it
 * reaches the persistence layer.
 */
const VALID_GOALS: readonly PlanGoal[] = [
  "strength",
  "hypertrophy",
  "fat_loss",
  "general_fitness",
];
const VALID_EXPERIENCE_LEVELS: readonly ExperienceLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
];

/**
 * DB-shaped profile row as the route port returns it. Declared locally (not
 * imported from `../db/repositories/*`) so the route stays free of any DB-layer
 * import — the composition root in `app.ts` builds the concrete adapter.
 */
interface UserProfileRow {
  userId: string;
  name: string;
  goal: PlanGoal | null;
  experienceLevel: ExperienceLevel | null;
}

/**
 * Route port for `/user-profile`. Exposes:
 *   - `findUserEmailById` — feeds lazy provisioning (default name = email prefix)
 *   - `findProfileByUserId` / `upsertProfile` — profile read + write
 *
 * User isolation is enforced by the single-column `userId` predicate: every
 * method is keyed ONLY on the authenticated session's `userId`, which the
 * route reads from `request.authContext` (never from client input).
 */
export interface UserProfileRouteRepo {
  findUserEmailById(userId: string): Promise<string | null>;
  findProfileByUserId(userId: string): Promise<UserProfileRow | null>;
  upsertProfile(
    userId: string,
    input: { name: string; goal: PlanGoal | null; experienceLevel: ExperienceLevel | null }
  ): Promise<UserProfileRow>;
}

export interface UserProfileRoutesOptions {
  repo: UserProfileRouteRepo;
}

interface UpdateProfileBody {
  name: string;
  goal?: PlanGoal | null;
  experienceLevel?: ExperienceLevel | null;
}

/**
 * Map a DB-shaped row to the lean contract `UserProfile` DTO (no timestamps).
 */
function toDTO(row: UserProfileRow): UserProfile {
  return {
    userId: row.userId,
    name: row.name,
    goal: row.goal,
    experienceLevel: row.experienceLevel,
  };
}

/**
 * Derive a default profile name from the email local part. Mirrors the
 * `provisionTenantForUser` default-name logic (registration inserts the same
 * prefix). Falls back to `"user"` when the email has no local part.
 */
function defaultNameFromEmail(email: string): string {
  const localPart = email.split("@")[0];
  return localPart && localPart.trim() !== "" ? localPart : "user";
}

/**
 * User profile routes (10a-user-memory-structured, Slice 2).
 *
 *   GET /user-profile  → return profile; lazily provision a default row when
 *                        none exists (name = email prefix, goal/exp = null).
 *   PUT /user-profile  → validate name non-blank + goal/experienceLevel enums,
 *                        partial-merge omitted fields against the stored row,
 *                        upsert the full target state.
 *
 * Both routes require auth via `requireAuth()`. `userId` comes only from the
 * authenticated session, never from the request body — user isolation is
 * enforced by construction.
 */
export const userProfileRoutes: FastifyPluginAsync<UserProfileRoutesOptions> = async (
  fastify,
  options
) => {
  const { repo } = options;

  // GET /user-profile
  fastify.get(
    "/user-profile",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;

      const existing = await repo.findProfileByUserId(userId);
      if (existing) {
        return reply.code(200).send(toDTO(existing));
      }

      // Lazy provisioning: derive a default name from the user's email and
      // insert a row with null goal/experienceLevel. Reading the email is the
      // only extra query and only on the first-ever GET for this user.
      const email = await repo.findUserEmailById(userId);
      const name = email ? defaultNameFromEmail(email) : "user";
      const created = await repo.upsertProfile(userId, {
        name,
        goal: null,
        experienceLevel: null,
      });
      return reply.code(200).send(toDTO(created));
    }
  );

  // PUT /user-profile
  fastify.put(
    "/user-profile",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;
      const body = request.body as UpdateProfileBody | null;

      // name is required and MUST be non-blank.
      if (
        body === null ||
        typeof body !== "object" ||
        typeof body.name !== "string" ||
        body.name.trim() === ""
      ) {
        return reply.code(422).send({ error: "name_required" });
      }

      // goal: undefined → preserve; null → explicit unset (valid); string → enum-check.
      if (
        body.goal !== undefined &&
        body.goal !== null &&
        !(VALID_GOALS as readonly string[]).includes(body.goal)
      ) {
        return reply.code(422).send({ error: "invalid_goal" });
      }

      // experienceLevel: same semantics as goal.
      if (
        body.experienceLevel !== undefined &&
        body.experienceLevel !== null &&
        !(VALID_EXPERIENCE_LEVELS as readonly string[]).includes(body.experienceLevel)
      ) {
        return reply.code(422).send({ error: "invalid_experience_level" });
      }

      // Partial merge: omitted goal/experienceLevel preserve the stored values.
      // The repo's upsert takes the FULL target state, so read the current row
      // and fill in the gaps. `null` (explicit unset) wins over the stored value.
      const existing = await repo.findProfileByUserId(userId);
      const finalGoal =
        body.goal !== undefined ? body.goal : (existing?.goal ?? null);
      const finalExperienceLevel =
        body.experienceLevel !== undefined
          ? body.experienceLevel
          : (existing?.experienceLevel ?? null);

      const updated = await repo.upsertProfile(userId, {
        name: body.name,
        goal: finalGoal,
        experienceLevel: finalExperienceLevel,
      });
      return reply.code(200).send(toDTO(updated));
    }
  );
};