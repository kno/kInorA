import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import type { CreateWeightEntryResponse, WeightEntryDTO } from "@kinora/contracts";

/**
 * Bound (0, 500] kg. `0` and negative are rejected (R "Bodyweight Entry
 * Recording" — non-positive weightKg → 422); the upper bound rejects an
 * obvious unit mistake, mirroring `heightCm`'s bound rationale in
 * `user-profile.ts`.
 */
const MIN_WEIGHT_KG = 0;
const MAX_WEIGHT_KG = 500;

/**
 * Route port for `/weight-entries` (17c-profile-body-metrics, PR 2). Both
 * methods read `userId` ONLY from `request.authContext` — never from the
 * body — so user isolation is enforced by construction.
 */
export interface UserWeightEntryRouteRepo {
  /** Newest `recordedAt` first, capped at 100. */
  list(userId: string): Promise<WeightEntryDTO[]>;
  /**
   * Inserts one entry. `wasFirstEntry` MUST be computed inside the same
   * insert transaction (`count(*) = 1` after insert) so it cannot fire twice
   * or race a second tab.
   */
  insert(
    userId: string,
    input: { weightKg: number; recordedAt?: string },
  ): Promise<CreateWeightEntryResponse>;
}

export interface UserWeightEntryRoutesOptions {
  repo: UserWeightEntryRouteRepo;
}

interface CreateWeightEntryBody {
  weightKg?: unknown;
  recordedAt?: unknown;
}

/**
 * Validate `weightKg` is a finite number in `(0, 500]`.
 */
function isValidWeightKg(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > MIN_WEIGHT_KG &&
    value <= MAX_WEIGHT_KG
  );
}

/**
 * Validate an optional `recordedAt`: when present it MUST parse to a valid
 * date and MUST NOT be in the future. `undefined` is valid (the repository
 * defaults to `now()`).
 */
function isValidRecordedAt(value: unknown): value is string | undefined {
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now();
}

/**
 * Bodyweight-series routes (17c-profile-body-metrics, PR 2).
 *
 *   GET /weight-entries  → the authenticated user's own entries, newest
 *                          `recordedAt` first, capped at 100.
 *   POST /weight-entries → create one entry; 201 `{ entry, wasFirstEntry }`.
 *
 * Both routes require auth via `requireAuth()`. `userId` comes only from the
 * authenticated session, never from the request body.
 */
export const userWeightEntryRoutes: FastifyPluginAsync<UserWeightEntryRoutesOptions> = async (
  fastify,
  options,
) => {
  const { repo } = options;

  // GET /weight-entries
  fastify.get(
    "/weight-entries",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;
      const entries = await repo.list(userId);
      return reply.code(200).send({ entries });
    },
  );

  // POST /weight-entries
  fastify.post(
    "/weight-entries",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;
      const body = (request.body ?? {}) as CreateWeightEntryBody;

      if (!isValidWeightKg(body.weightKg)) {
        return reply.code(422).send({ error: "invalid_weight_kg" });
      }
      if (!isValidRecordedAt(body.recordedAt)) {
        return reply.code(422).send({ error: "invalid_recorded_at" });
      }

      const result = await repo.insert(userId, {
        weightKg: body.weightKg,
        recordedAt: body.recordedAt,
      });
      return reply.code(201).send(result);
    },
  );
};
