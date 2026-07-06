import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "../db/client.js";
import { requireAuth } from "../auth/plugin.js";
import {
  WorkoutSessionRepository,
  type UpdateSetRecordInput,
} from "../db/repositories/workout-session.js";
import { validateRpe } from "@kinora/domain";

export interface WorkoutSessionRoutesOptions {
  db: Database;
  repo?: Pick<
    WorkoutSessionRepository,
    "startSession" | "findById" | "recordSet" | "completeSession"
  >;
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
  const repo = options.repo ?? new WorkoutSessionRepository(options.db);

  fastify.post(
    "/workout-sessions",
    { schema: startSessionSchema, preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const body = request.body as { workoutPlanId: string; day: number };

      const session = await repo.startSession(tenantId, userId, body.workoutPlanId, body.day);
      if (!session) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send(session);
    }
  );

  fastify.get(
    "/workout-sessions/:id",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params as { id: string };

      const session = await repo.findById(tenantId, userId, id);
      if (!session) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send(session);
    }
  );

  fastify.patch(
    "/workout-sessions/:id/sets/:setId",
    { schema: updateSetSchema, preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const { id, setId } = request.params as { id: string; setId: string };
      const body = request.body as UpdateSetRecordInput;

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

  fastify.post(
    "/workout-sessions/:id/complete",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params as { id: string };

      const session = await repo.completeSession(tenantId, userId, id);
      if (!session) {
        return reply.code(404).send({ error: "not_found" });
      }

      return reply.code(200).send(session);
    }
  );
};
