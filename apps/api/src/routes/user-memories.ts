import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type {
  CreateUserMemoryRequest,
  DeleteUserMemoryResponse,
  ListUserMemoriesResponse,
  UpdateMemorySettingsRequest,
} from "@kinora/contracts";
import { requireAuth } from "../auth/plugin.js";
import type { UserMemoryLifecycleService } from "../user-memory/service.js";

export interface UserMemoryRoutesOptions {
  service: Pick<
    UserMemoryLifecycleService,
    "listForOwner" | "createConfirmed" | "deleteMemory" | "setEnabled"
  >;
}

export const userMemoryRoutes: FastifyPluginAsync<UserMemoryRoutesOptions> = async (
  fastify,
  options,
) => {
  const { service } = options;

  fastify.get(
    "/user-memories",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const response = await service.listForOwner(authScope(request));
      return reply.code(200).send(response satisfies ListUserMemoriesResponse);
    },
  );

  fastify.post(
    "/user-memories",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as CreateUserMemoryRequest | null;
      if (
        body === null ||
        typeof body !== "object" ||
        typeof body.factText !== "string" ||
        body.factText.trim() === "" ||
        typeof body.idempotencyKey !== "string" ||
        body.idempotencyKey.trim() === "" ||
        typeof body.source !== "string" ||
        body.source !== "user_confirmation"
      ) {
        return reply.code(422).send({ error: "invalid_user_memory_request" });
      }

      // 11a billing: the premium `memory_write` gate lives INSIDE
      // createConfirmed — it consumes the unit after eligibility + enabled pass
      // and just before embed+store, so an entitlement/quota denial still blocks
      // before any embedding cost while a rejected/disabled write spends
      // nothing. A denial surfaces here as a 403 (kind "denied"); a gate
      // technical error propagates as a 500 (fail-closed).
      const result = await service.createConfirmed(authScope(request), body);
      if (result.kind === "stored") {
        return reply.code(200).send({ memory: result.memory });
      }
      if (result.kind === "rejected") {
        return reply.code(422).send({ error: "memory_ineligible", reason: result.reason });
      }
      if (result.kind === "denied") {
        return reply.code(403).send({ error: result.reason });
      }
      if (result.reason === "disabled") {
        return reply.code(409).send({ error: "memory_disabled" });
      }
      if (result.reason === "dimension_mismatch") {
        return reply.code(422).send({ error: "memory_embedding_invalid" });
      }
      return reply.code(503).send({ error: "memory_unavailable" });
    },
  );

  fastify.delete(
    "/user-memories/:id",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { id?: string };
      if (!params.id?.trim()) {
        return reply.code(422).send({ error: "memory_id_required" });
      }
      const result = await service.deleteMemory(authScope(request), params.id);
      if (result.kind === "deleted") {
        return reply.code(200).send({ deleted: true } satisfies DeleteUserMemoryResponse);
      }
      return reply.code(404).send({ error: "memory_not_found" });
    },
  );

  fastify.patch(
    "/user-memories/settings",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as UpdateMemorySettingsRequest | null;
      if (body === null || typeof body !== "object" || typeof body.enabled !== "boolean") {
        return reply.code(422).send({ error: "invalid_memory_settings_request" });
      }
      const settings = await service.setEnabled(authScope(request), body.enabled);
      return reply.code(200).send(settings);
    },
  );
};

function authScope(request: { authContext: FastifyRequest["authContext"] }) {
  return {
    tenantId: request.authContext!.tenantId,
    userId: request.authContext!.userId,
  };
}
