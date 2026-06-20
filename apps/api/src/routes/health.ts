/**
 * Health route — STUB for TDD RED phase.
 * No GET /health route registered; all 6 tests return 404 or undefined fields.
 */

import type { FastifyInstance, FastifyPluginCallback } from "fastify";

export const healthRoute: FastifyPluginCallback = async (
  _fastify: FastifyInstance
) => {
  // Stub: no routes registered — all inject() calls return 404
};
