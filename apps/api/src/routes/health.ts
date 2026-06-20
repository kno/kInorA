import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { HealthResponse } from "@kinora/contracts";

const startTime = Date.now();

export const healthRoute: FastifyPluginCallback = async (
  fastify: FastifyInstance
) => {
  fastify.get("/health", async () => {
    const response: HealthResponse = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - startTime) / 1000,
    };
    return response;
  });
};