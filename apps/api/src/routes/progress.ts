import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import type { DashboardSummaryDTO } from "@kinora/contracts";

export interface ProgressRouteRepo {
  getDashboardSummary(tenantId: string, userId: string): Promise<DashboardSummaryDTO>;
}

export interface ProgressRoutesOptions {
  repo: ProgressRouteRepo;
}

/**
 * Thin `/progress/*` routes (09c-v1-progress-dashboard-stats, Slice 2).
 *
 * Pass-through to `ProgressRouteRepo.getDashboardSummary` — all aggregation
 * lives in the repository + pure domain functions (design.md "Read model
 * boundary: one bounded query per surface"). `tenantId`/`userId` come only
 * from the authenticated session, never from client input.
 */
export const progressRoutes: FastifyPluginAsync<ProgressRoutesOptions> = async (fastify, options) => {
  const repo = options.repo;

  fastify.get(
    "/progress/dashboard",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const summary = await repo.getDashboardSummary(tenantId, userId);
      return reply.code(200).send(summary);
    }
  );
};
