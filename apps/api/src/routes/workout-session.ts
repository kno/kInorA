import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { validateRpe } from "@kinora/domain";
import type {
  DeleteSessionOutcome,
  StartSessionOutcome,
  WorkoutHistoryEntry,
  WorkoutHistoryQuery,
  WorkoutSessionRecord,
} from "@kinora/contracts";

interface UpdateSetBody {
  actualReps?: number;
  weightKg?: number;
  rpe?: number;
  completed: boolean;
  notes?: string;
}

interface StartSessionBody {
  workoutPlanId: string;
  day: number;
}

interface SessionParams {
  id: string;
}

interface SetParams extends SessionParams {
  setId: string;
}

interface HistoryQuerystring {
  limit?: number;
  offset?: number;
}

export interface WorkoutSessionRouteRepo {
  startSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    day: number
  ): Promise<StartSessionOutcome | undefined>;
  findById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<WorkoutSessionRecord | undefined>;
  recordSet(
    tenantId: string,
    userId: string,
    sessionId: string,
    setId: string,
    input: UpdateSetBody
  ): Promise<WorkoutSessionRecord | undefined>;
  completeSession(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<WorkoutSessionRecord | undefined>;
  /**
   * Delete one session owned by the caller (10c-workout-session-delete).
   * The repo scopes the delete by (tenantId, userId, id) and guards active
   * sessions — see {@link WorkoutSessionRepository.deleteById}.
   */
  deleteById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<DeleteSessionOutcome>;
  deleteAllByUser(
    tenantId: string,
    userId: string
  ): Promise<{ kind: "deleted"; deletedCount: number } | { kind: "active_conflict" }>;
  listCompletedSessions(
    tenantId: string,
    userId: string,
    query: WorkoutHistoryQuery
  ): Promise<WorkoutHistoryEntry[]>;
}

export interface WorkoutSessionRoutesOptions {
  repo: WorkoutSessionRouteRepo;
}

const startSessionSchema = {
  body: {
    type: "object",
    required: ["workoutPlanId", "day"],
    properties: {
      workoutPlanId: { type: "string" },
      // day is 1-based within a weekly program. Upper bound is a weekly cap
      // (a program has one session per training day, max 7/week); values >7
      // are rejected with a 422 (risk-WARNING). minimum:1 stays.
      day: { type: "integer", minimum: 1, maximum: 7 },
    },
    additionalProperties: false,
  },
};

const historySchema = {
  querystring: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      offset: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
};

const updateSetSchema = {
  body: {
    type: "object",
    required: ["completed"],
    properties: {
      actualReps: { type: "integer", minimum: 0 },
      weightKg: { type: "number", minimum: 0 },
      rpe: { type: "number" },
      completed: { type: "boolean" },
      notes: { type: "string" },
    },
    additionalProperties: false,
  },
};

export const workoutSessionRoutes: FastifyPluginAsync<WorkoutSessionRoutesOptions> = async (
  fastify,
  options
) => {
  const repo = options.repo;

  fastify.post<{ Body: StartSessionBody }>(
    "/workout-sessions",
    { schema: startSessionSchema, preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const { workoutPlanId, day } = request.body;

      const outcome = await repo.startSession(tenantId, userId, workoutPlanId, day);
      // undefined → plan not ready / day not in program (unchanged 404 contract).
      if (!outcome) {
        return reply.code(404).send({ error: "not_found" });
      }

      // A different active (planId, day) — or a legacy null-day session — cannot
      // be resumed without ending the current one. Surface an explicit 409 with
      // the active scope so the client can render a banner instead of silently
      // resuming the wrong day or collapsing into a generic error.
      if (outcome.kind === "conflict") {
        return reply.code(409).send({
          error: "active_session_conflict",
          activePlanName: outcome.activePlanName,
          activeDay: outcome.activeDay,
        });
      }

      // started | resumed → 200 with the session snapshot (unchanged shape).
      return reply.code(200).send(outcome.session);
    }
  );

  // Registered BEFORE `/workout-sessions/:id` — a static path segment always
  // wins over a parametric one in Fastify's router regardless of
  // registration order, but the ordering here documents that intent
  // explicitly. History is sync-independent: it never touches the offline
  // queue/snapshot, only reads completed sessions.
  fastify.get<{ Querystring: HistoryQuerystring }>(
    "/workout-sessions/history",
    { schema: historySchema, preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const { limit, offset } = request.query;

      const entries = await repo.listCompletedSessions(tenantId, userId, {
        limit: limit ?? 20,
        offset: offset ?? 0,
      });

      return reply.code(200).send(entries);
    }
  );

  fastify.get<{ Params: SessionParams }>(
    "/workout-sessions/:id",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params;

      const session = await repo.findById(tenantId, userId, id);
      if (!session) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send(session);
    }
  );

  fastify.patch<{ Params: SetParams; Body: UpdateSetBody }>(
    "/workout-sessions/:id/sets/:setId",
    { schema: updateSetSchema, preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const { id, setId } = request.params;
      const body = request.body;

      if (body.rpe !== undefined) {
        const rpeValidation = validateRpe(body.rpe);
        if (!rpeValidation.ok) {
          return reply.code(422).send({ error: rpeValidation.reason });
        }
      }

      const session = await repo.recordSet(tenantId, userId, id, setId, body);
      if (!session) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send(session);
    }
  );

  fastify.post<{ Params: SessionParams }>(
    "/workout-sessions/:id/complete",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params;

      const session = await repo.completeSession(tenantId, userId, id);
      if (!session) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send(session);
    }
  );

  // DELETE /workout-sessions/:id (10c-workout-session-delete, R1 + R3).
  // Tenant + user scoping and the active-session guard live in the repo; the
  // route only translates the discriminated outcome into HTTP statuses:
  //   deleted          → 204 (no body)
  //   not_found        → 404 (covers nonexistent, another user's, another
  //                          tenant's — indistinguishable, no existence leak)
  //   active_conflict  → 409 (the caller must complete/cancel the session
  //                          before deleting it)
  fastify.delete<{ Params: SessionParams }>(
    "/workout-sessions/:id",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params;

      const outcome = await repo.deleteById(tenantId, userId, id);
      if (outcome.kind === "not_found") {
        return reply.code(404).send({ error: "not_found" });
      }
      if (outcome.kind === "active_conflict") {
        return reply.code(409).send({ error: "active_session_conflict" });
      }
      return reply.code(204).send();
    }
  );

  // DELETE /workout-sessions (10c-workout-session-delete, R2 + R3).
  // The repo keeps the same tenant/user scoping + active-session guard as the
  // single-delete path. The route only translates outcomes:
  //   deleted          → 200 + { deletedCount }
  //   active_conflict  → 409
  fastify.delete(
    "/workout-sessions",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;

      const outcome = await repo.deleteAllByUser(tenantId, userId);
      if (outcome.kind === "active_conflict") {
        return reply.code(409).send({ error: "active_session_conflict" });
      }

      return reply.code(200).send({ deletedCount: outcome.deletedCount });
    }
  );
};
