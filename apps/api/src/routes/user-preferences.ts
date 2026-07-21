import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import type { UserPreferences } from "@kinora/contracts";

/**
 * DB-shaped preferences row as the route port returns it. Declared locally
 * (not imported from `../db/repositories/*`) so the route stays free of any
 * DB-layer import — the composition root in `app.ts` builds the adapter.
 */
interface UserPreferencesRow {
  userId: string;
  defaultLocation: string | null;
  defaultDuration: number | null;
  defaultEquipment: string[] | null;
}

/**
 * Partial upsert input. Every field is OPTIONAL:
 *   - field absent  → leave the stored value unchanged (partial merge)
 *   - field present → write the value (the repo handles INSERT default + ON
 *                     CONFLICT SET omission for absent keys)
 * `null` is not part of the contract's user-facing shape; the route never
 * forwards `null` — to "unset" a preference the UI omits it (preferring the
 * additive, null-default model from the design).
 */
type PreferencesUpdateInput = Partial<
  Pick<UserPreferencesRow, "defaultLocation" | "defaultDuration" | "defaultEquipment">
>;

/**
 * Route port for `/user-preferences`. Exposes read + partial-merge upsert.
 * User isolation is enforced by the single-column `userId` predicate, which
 * the route feeds only from the authenticated session.
 */
export interface UserPreferencesRouteRepo {
  findPreferencesByUserId(userId: string): Promise<UserPreferencesRow | null>;
  upsertPreferences(
    userId: string,
    input: PreferencesUpdateInput
  ): Promise<UserPreferencesRow>;
}

export interface UserPreferencesRoutesOptions {
  repo: UserPreferencesRouteRepo;
}

interface UpdatePreferencesBody {
  defaultLocation?: string;
  defaultDuration?: number;
  defaultEquipment?: string[];
}

/**
 * Map a DB-shaped row to the lean contract `UserPreferences` DTO.
 */
function toDTO(row: UserPreferencesRow): UserPreferences {
  return {
    userId: row.userId,
    defaultLocation: row.defaultLocation,
    defaultDuration: row.defaultDuration,
    defaultEquipment: row.defaultEquipment,
  };
}

/**
 * Build the DTO returned when the user has no preferences row yet. The design
 * ("Wizard Pre-fill") treats all-null as a no-op, so a missing row is modelled
 * as a 200 with null fields rather than a 204/404 — the wizard checks for null
 * rather than parsing a separate empty-status path.
 */
function emptyDTO(userId: string): UserPreferences {
  return {
    userId,
    defaultLocation: null,
    defaultDuration: null,
    defaultEquipment: null,
  };
}

/**
 * User preferences routes (10a-user-memory-structured, Slice 2).
 *
 *   GET /user-preferences  → return preferences, or all-null fields when none.
 *   PUT /user-preferences  → partial merge (undefined fields stay unchanged);
 *                            reject non-positive `defaultDuration` with 422.
 *
 * Both routes require auth via `requireAuth()`. `userId` is sourced only from
 * the authenticated session.
 */
export const userPreferencesRoutes: FastifyPluginAsync<UserPreferencesRoutesOptions> = async (
  fastify,
  options
) => {
  const { repo } = options;

  // GET /user-preferences
  fastify.get(
    "/user-preferences",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;

      const existing = await repo.findPreferencesByUserId(userId);
      if (!existing) {
        return reply.code(200).send(emptyDTO(userId));
      }
      return reply.code(200).send(toDTO(existing));
    }
  );

  // PUT /user-preferences
  fastify.put(
    "/user-preferences",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;
      const body = request.body as UpdatePreferencesBody | null;

      // defaultDuration, when provided, MUST be a positive integer. The repo
      // guards again (defense in depth) but the route returns 422 to the client.
      if (
        body?.defaultDuration !== undefined &&
        (typeof body.defaultDuration !== "number" ||
          !Number.isInteger(body.defaultDuration) ||
          body.defaultDuration <= 0)
      ) {
        return reply.code(422).send({ error: "invalid_default_duration" });
      }

      // Build the partial input: forward ONLY sent fields. The repo's partial
      // merge lives in the ON CONFLICT SET clause — absent keys preserve the
      // stored value. We never forward `undefined` here; we omit the key.
      const input: PreferencesUpdateInput = {};
      if (body && "defaultLocation" in body) {
        input.defaultLocation = body.defaultLocation;
      }
      if (body && "defaultDuration" in body) {
        input.defaultDuration = body.defaultDuration;
      }
      if (body && "defaultEquipment" in body) {
        input.defaultEquipment = body.defaultEquipment;
      }

      const updated = await repo.upsertPreferences(userId, input);
      return reply.code(200).send(toDTO(updated));
    }
  );
};