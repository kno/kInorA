import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { validateRpe } from "@kinora/domain";
import type { WorkoutSessionRecord } from "@kinora/contracts";

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

export interface WorkoutSessionRouteRepo {
  startSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    day: number
  ): Promise<WorkoutSessionRecord | undefined>;
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
      day: { type: "integer", minimum: 1 },
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

      const session = await repo.startSession(tenantId, userId, workoutPlanId, day);
      if (!session) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send(session);
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
};
