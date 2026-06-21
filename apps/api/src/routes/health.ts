import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { HealthResponse } from "@kinora/contracts";

const healthResponse: HealthResponse = { status: "ok" };

export const healthRoute: FastifyPluginCallback = async (
  fastify: FastifyInstance
) => {
  fastify.get("/health", async () => healthResponse);
  fastify.get("/api/health", async () => healthResponse);
};
