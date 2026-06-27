import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { Database } from "../db/client.js";
import { requireAuth } from "../auth/plugin.js";
import { PlanDraftRepository } from "../db/repositories/plan-draft.js";
import { PlanSpecRepository } from "../db/repositories/plan-spec.js";
import { assertPlanSpecInput, assertPlanSpecShape } from "../plan/boundary.js";
import { derivePreferenceScores } from "@kinora/domain";
import type { PlanSpec } from "@kinora/contracts";

export interface PlanRoutesOptions {
  db: Database;
}

/**
 * JSON schema for POST /plan-specs/drafts body validation.
 * Requires step (integer) and spec (object).
 * Fastify uses ajv under the hood; missing or wrongly-typed fields cause a
 * 400 (mapped in the app error handler) instead of a silent 500.
 */
const saveDraftSchema = {
  body: {
    type: "object",
    required: ["step", "spec"],
    properties: {
      step: { type: "integer" },
      spec: { type: "object" },
    },
    additionalProperties: true,
  },
};

/**
 * Plan route plugin — implements the three plan wizard API endpoints.
 *
 * All routes require authentication via requireAuth() preHandler which reads
 * request.authContext populated by the global auth plugin.
 *
 * Tenant and user are always read from authContext — never from the request body.
 *
 * Routes:
 *   POST /plan-specs/drafts         — upsert the current draft (step + partial spec)
 *   GET  /plan-specs/drafts/current — return current draft or 204
 *   POST /plan-specs                — promote draft to confirmed plan_specs row; 409 if missing/incomplete
 *
 * The promote endpoint persists a confirmed PlanSpec ONLY — no workout program is
 * generated here. That is the responsibility of change 08 (ai-plan-generation).
 */
export const planRoutes: FastifyPluginAsync<PlanRoutesOptions> = async (
  fastify,
  options
) => {
  const { db } = options;
  const draftRepo = new PlanDraftRepository(db);
  const specRepo = new PlanSpecRepository(db);

  // POST /plan-specs/drafts
  // Body: { step: number; spec: Partial<PlanSpec> }
  // Returns: { step: number; spec: Partial<PlanSpec> }
  fastify.post(
    "/plan-specs/drafts",
    { schema: saveDraftSchema, preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const body = request.body as { step: number; spec: Partial<PlanSpec> };

      const draft = await draftRepo.upsert(tenantId, userId, body.step, body.spec);
      return reply.code(200).send({ step: draft.step, spec: draft.specJson });
    }
  );

  // GET /plan-specs/drafts/current
  // Returns: { step: number; spec: Partial<PlanSpec> } or 204 if none
  fastify.get(
    "/plan-specs/drafts/current",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;

      const draft = await draftRepo.findCurrent(tenantId, userId);
      if (!draft) {
        return reply.code(204).send();
      }
      return reply.code(200).send({ step: draft.step, spec: draft.specJson });
    }
  );

  // POST /plan-specs
  // Promotes the current draft to a confirmed plan_specs row.
  // Reads the draft, validates the spec shape, derives preferenceScores,
  // inserts the plan_specs row, and deletes the draft atomically.
  // Returns: 201 { id: string; spec: PlanSpec }
  // Returns: 409 if no draft or spec is incomplete/invalid
  fastify.post(
    "/plan-specs",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;

      const draft = await draftRepo.findCurrent(tenantId, userId);
      if (!draft) {
        return reply.code(409).send({ error: "no_active_draft" });
      }

      // Validate wizard input fields (goal, daysPerWeek, etc.) BEFORE deriving.
      // A real wizard draft never has preferenceScores or confirmed — those are
      // server-derived. assertPlanSpecInput does NOT require them.
      const rawSpec = draft.specJson as unknown;
      try {
        assertPlanSpecInput(rawSpec);
      } catch {
        return reply.code(409).send({ error: "incomplete_spec" });
      }

      // Derive preferenceScores server-side (source of truth) and build the
      // full confirmed spec from the validated input fields.
      const inputSpec = rawSpec as Pick<
        PlanSpec,
        "goal" | "daysPerWeek" | "sessionDurationMinutes" | "location" | "equipment" | "limitations"
      >;
      const preferenceScores = derivePreferenceScores(inputSpec);
      const confirmedSpec: PlanSpec = { ...inputSpec, preferenceScores, confirmed: true };

      // Final integrity guard — confirmedSpec must now satisfy the full PlanSpec shape.
      // This should always pass given correct derivation; if it throws, it is a server bug.
      assertPlanSpecShape(confirmedSpec);

      // Insert the confirmed plan_specs row and delete the draft in a single
      // transaction so that either both succeed or neither does — no orphan
      // draft or duplicate spec row on partial failure.
      const result = await db.transaction(async (tx) => {
        const specResult = await specRepo.create(tenantId, userId, confirmedSpec, tx);
        await draftRepo.delete(tenantId, userId, tx);
        return specResult;
      });

      return reply.code(201).send({ id: result.id, spec: result.spec });
    }
  );
};
