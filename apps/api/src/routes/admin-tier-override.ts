import { z } from "zod";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { buildRequireAdmin } from "../auth/require-admin.js";
import {
  GrantTenantTierOverride,
  RevokeTenantTierOverride,
  type TierOverrideAdminPort,
} from "../billing/tier-override-admin.js";

/**
 * Zod schema for the grant body. `tier` MUST be `trainer`/`gym` (`free`/`pro`
 * are rejected — spec `Requirement: Grant Validation`). `reason` MUST be
 * non-empty (the column is `NOT NULL`). `startsAt`/`endsAt` are optional
 * ISO-8601 strings; the use case defaults them to now / the open-ended
 * sentinel.
 */
const grantBodySchema = z.object({
  tier: z.enum(["trainer", "gym"]),
  reason: z.string().min(1),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  // Optional client-supplied idempotency key (#313): a grant retried after a
  // network timeout carries the same key so the server replays the original
  // 201 instead of a spurious 409. Bounded length keeps it index-friendly.
  operationKey: z.string().min(1).max(200).optional(),
});

/**
 * `tenantId` path-param schema. A malformed value (e.g. `not-a-uuid`) would
 * otherwise reach Postgres as an invalid `uuid` literal and throw, falling
 * through to the generic 500 error handler — reject it up front as a 422
 * instead, mirroring the body-validation branch below.
 *
 * Uses a plain 8-4-4-4-12 hex shape check (matching Postgres's own `uuid`
 * column format) rather than `z.string().uuid()`'s strict RFC 4122
 * version/variant nibble check — test fixtures throughout this codebase use
 * non-RFC-compliant UUID literals (e.g. `bbbbbbbb-0000-0000-...`) as tenant
 * IDs, which Postgres itself accepts as valid `uuid` values.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tenantIdParamsSchema = z.object({
  tenantId: z.string().regex(UUID_SHAPE),
});

/**
 * Route port for the admin tier-override endpoints. Mirrors
 * `AdminAiConfigRouteRepo`: `findUserById` feeds `buildRequireAdmin`; the
 * remaining methods satisfy `TierOverrideAdminPort` so the SAME port object
 * can be passed straight into the pure use cases. The concrete adapter
 * (`UserRepository` + `TierOverrideAdminRepository`) is composed in app.ts —
 * this route file has ZERO `db/*` import (dep-cruiser `routes-no-db-layer`).
 */
export interface AdminTierOverrideRouteRepo extends TierOverrideAdminPort {
  /** Feeds buildRequireAdmin via { findById: repo.findUserById }. */
  findUserById(id: string): Promise<{ id: string; isAdmin: boolean } | null>;
}

export interface AdminTierOverrideRoutesOptions {
  repo: AdminTierOverrideRouteRepo;
}

const DENIAL_STATUS: Record<string, number> = {
  unknown_tenant: 404,
  active_override_exists: 409,
  no_active_override: 409,
};

/**
 * Admin tier-override routes (16d-admin-tier-provisioning).
 *
 * All routes require:
 *   1. requireAuth()    — 401 if no session
 *   2. requireAdmin     — 403 if not `users.is_admin = true`
 *
 * Routes:
 *   POST /admin/tenants/:tenantId/tier-override         → grant  (201/404/409/422)
 *   POST /admin/tenants/:tenantId/tier-override/revoke  → revoke (200/409)
 */
export const adminTierOverrideRoutes: FastifyPluginAsync<AdminTierOverrideRoutesOptions> = async (
  fastify,
  options,
) => {
  const { repo } = options;

  const requireAdmin = buildRequireAdmin({ findById: repo.findUserById });
  const grantTierOverride = new GrantTenantTierOverride(repo);
  const revokeTierOverride = new RevokeTenantTierOverride(repo);

  fastify.post(
    "/admin/tenants/:tenantId/tier-override",
    { preHandler: [requireAuth(), requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = tenantIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.code(422).send({ error: "Validation Error" });
      }
      const { tenantId } = paramsResult.data;

      const result = grantBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(422).send({ error: "Validation Error" });
      }

      const outcome = await grantTierOverride.execute({
        tenantId,
        actorUserId: request.authContext!.userId,
        tier: result.data.tier,
        reason: result.data.reason,
        startsAt: result.data.startsAt,
        endsAt: result.data.endsAt,
        operationKey: result.data.operationKey,
      });

      if (!outcome.ok) {
        const status = DENIAL_STATUS[outcome.reason] ?? 422;
        return reply.code(status).send({ error: outcome.reason });
      }

      return reply.code(201).send({
        id: outcome.override.id,
        tenantId: outcome.override.tenantId,
        tier: outcome.override.tier,
        reason: outcome.override.reason,
        startsAt: outcome.override.startsAt.toISOString(),
        endsAt: outcome.override.endsAt.toISOString(),
      });
    },
  );

  fastify.post(
    "/admin/tenants/:tenantId/tier-override/revoke",
    { preHandler: [requireAuth(), requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = tenantIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.code(422).send({ error: "Validation Error" });
      }
      const { tenantId } = paramsResult.data;

      const outcome = await revokeTierOverride.execute({
        tenantId,
        actorUserId: request.authContext!.userId,
      });

      if (!outcome.ok) {
        const status = DENIAL_STATUS[outcome.reason] ?? 422;
        return reply.code(status).send({ error: outcome.reason });
      }

      return reply.code(200).send({
        id: outcome.override.id,
        tenantId: outcome.override.tenantId,
        endsAt: outcome.override.endsAt.toISOString(),
      });
    },
  );
};
