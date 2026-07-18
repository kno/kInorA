import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import type { DashboardSummaryDTO, ExerciseDetailDTO, StatsSummaryDTO, WeeklyOverviewDTO } from "@kinora/contracts";

type StatsRange = "week" | "month" | "year";

const STATS_RANGES: readonly StatsRange[] = ["week", "month", "year"];

function parseStatsRange(value: unknown): StatsRange {
  return typeof value === "string" && (STATS_RANGES as readonly string[]).includes(value)
    ? (value as StatsRange)
    : "month";
}

/**
 * Parses `?weekStart=YYYY-MM-DD` into a `Date` (Slice 4b). Falls back to
 * `new Date()` (the current week) for a missing or invalid value — never a
 * 400, mirroring `parseStatsRange`'s fail-open default.
 */
function parseWeekStart(value: unknown): Date {
  if (typeof value !== "string") {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export interface ProgressRouteRepo {
  getDashboardSummary(tenantId: string, userId: string): Promise<DashboardSummaryDTO>;
  getStatsRange(tenantId: string, userId: string, range: StatsRange): Promise<StatsSummaryDTO>;
  getWeeklyOverview(tenantId: string, userId: string, weekStart: Date): Promise<WeeklyOverviewDTO>;
  getExerciseDetail(tenantId: string, userId: string, title: string): Promise<ExerciseDetailDTO>;
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

  /**
   * Weekly plan board (09c-v1-progress-dashboard-stats, Slice 4b) — the
   * Monday–Sunday day-state array + prev/next navigation for the requested
   * `?weekStart=`. Missing/invalid `?weekStart=` falls back to the current
   * week (fail-open, mirrors `/progress/stats`'s `?range=` default).
   */
  fastify.get(
    "/progress/weekly-overview",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const weekStart = parseWeekStart((request.query as { weekStart?: string } | undefined)?.weekStart);
      const overview = await repo.getWeeklyOverview(tenantId, userId, weekStart);
      return reply.code(200).send(overview);
    }
  );

  /**
   * Read-only exercise-history reference (09c-v1-progress-dashboard-stats,
   * Slice 4b). `?title=` is REQUIRED (400 when missing) — it is free-text
   * supplied by the caller but is only ever used as an additional filter
   * inside the caller's own (tenantId, userId)-scoped rows; it can never
   * widen the scope to another user's or tenant's data (design.md "Read
   * model boundary: one bounded query per surface").
   */
  fastify.get(
    "/progress/exercise-detail",
    { preHandler: requireAuth() },
    async (request, reply) => {
      const { tenantId, userId } = request.authContext!;
      const title = (request.query as { title?: string } | undefined)?.title;
      if (typeof title !== "string" || title.trim() === "") {
        return reply.code(400).send({ error: "title_required" });
      }
      const detail = await repo.getExerciseDetail(tenantId, userId, title);
      return reply.code(200).send(detail);
    }
  );
};
