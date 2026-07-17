import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import type { DashboardSummaryDTO, StatsSummaryDTO } from "@kinora/contracts";

type StatsRange = "week" | "month" | "year";

const STATS_RANGES: readonly StatsRange[] = ["week", "month", "year"];

function parseStatsRange(value: unknown): StatsRange {
  return typeof value === "string" && (STATS_RANGES as readonly string[]).includes(value)
    ? (value as StatsRange)
    : "month";
}

export interface ProgressRouteRepo {
  getDashboardSummary(tenantId: string, userId: string): Promise<DashboardSummaryDTO>;
  getStatsRange(tenantId: string, userId: string, range: StatsRange): Promise<StatsSummaryDTO>;
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

  /**
   * Statistics summary (09c-v1-progress-dashboard-stats, Slice 3a) — KPIs
   * with period deltas + volume trend for the requested `range`. Invalid or
   * missing `?range=` falls back to `month` (matches the "Mes" default pill
   * in `web-stats.html`) rather than erroring.
   */
  fastify.get(
    "/progress/stats",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const range = parseStatsRange((request.query as { range?: string } | undefined)?.range);
      const summary = await repo.getStatsRange(tenantId, userId, range);
      return reply.code(200).send(summary);
    }
  );
};
