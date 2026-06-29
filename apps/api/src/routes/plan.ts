import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { Database } from "../db/client.js";
import { requireAuth } from "../auth/plugin.js";
import { PlanDraftRepository } from "../db/repositories/plan-draft.js";
import { PlanSpecRepository } from "../db/repositories/plan-spec.js";
import { WorkoutPlanRepository } from "../db/repositories/workout-plan.js";
import { assertPlanSpecInput, assertPlanSpecShape } from "../plan/boundary.js";
import { derivePreferenceScores } from "@kinora/domain";
import type { PlanSpec } from "@kinora/contracts";
import type { PlanGenerationService } from "../ai/generation-service.js";

export interface PlanRoutesOptions {
  db: Database;
  /**
   * Injectable generation service — defaults to constructing a new instance
   * backed by the real OpenRouterPlanGenerator in production.
   * Pass a mock in tests to avoid LLM calls.
   */
  generationService?: Pick<PlanGenerationService, "startGeneration">;
  /**
   * Injectable WorkoutPlanRepository — defaults to constructing from db.
   * Pass a mock in tests.
   */
  planRepo?: Pick<WorkoutPlanRepository, "findById" | "findLatestByPlanSpec">;
  /**
   * Injectable PlanSpecRepository — defaults to constructing from db.
   * Pass a mock in tests to control findConfirmedById results.
   */
  specRepo?: Pick<PlanSpecRepository, "findConfirmedById" | "create">;
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
 * Plan route plugin — implements plan wizard and generation API endpoints.
 *
 * All routes require authentication via requireAuth() preHandler which reads
 * request.authContext populated by the global auth plugin.
 *
 * Tenant and user are always read from authContext — never from the request body.
 *
 * Routes:
 *   POST /plan-specs/drafts             — upsert the current draft (step + partial spec)
 *   GET  /plan-specs/drafts/current     — return current draft or 204
 *   POST /plan-specs                    — promote draft to confirmed plan_specs row; 409 if missing/incomplete
 *   POST /plan-specs/:id/confirm        — confirm spec + trigger generation; returns { planId, status: "generating" }
 *   POST /plan-specs/:id/regenerate     — re-trigger generation for confirmed spec; returns 202 { planId, status: "generating" }
 *   GET  /workout-plans/:id             — fetch a plan by id (tenant-scoped)
 *   GET  /plan-specs/:id/workout-plan   — fetch the latest plan for a spec (tenant-scoped)
 *
 * Stuck-generating strategy: MANUAL REGENERATE ONLY.
 * Stale "generating" rows from aborted generation (e.g. server restart) are
 * NOT auto-swept. They remain visible for audit. The user triggers regenerate
 * explicitly (POST /plan-specs/:id/regenerate), which creates a fresh row.
 * The stale row is retained; only the latest is shown via findLatestByPlanSpec.
 */
export const planRoutes: FastifyPluginAsync<PlanRoutesOptions> = async (
  fastify,
  options
) => {
  const { db } = options;
  const draftRepo = new PlanDraftRepository(db);
  const specRepo = options.specRepo ?? new PlanSpecRepository(db);
  const planRepo = options.planRepo ?? new WorkoutPlanRepository(db);

  // generationService is resolved lazily (only required for generation routes)
  // so that the existing wizard routes continue to work even without it.
  const generationService = options.generationService;

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

  // POST /plan-specs/:id/confirm
  // Confirms the spec and immediately starts plan generation.
  // Requires the spec to already exist as a confirmed plan_specs row (from the wizard promote step).
  // Returns: 200 { planId: string; status: "generating" }
  // Returns: 422 if spec is missing, unconfirmed, or fails shape validation
  // Returns: 401 if not authenticated
  //
  // Stuck-generating: if a prior "generating" row stalls (e.g. server restart),
  // the user triggers regenerate (POST /plan-specs/:id/regenerate) to create a
  // fresh row. Stale rows are retained for audit.
  fastify.post(
    "/plan-specs/:id/confirm",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params as { id: string };

      const svc = generationService;
      if (!svc) {
        return reply.code(503).send({ error: "generation_service_unavailable" });
      }

      const result = await svc.startGeneration(tenantId, userId, id);
      return reply.code(200).send(result);
    }
  );

  // POST /plan-specs/:id/regenerate
  // Re-triggers plan generation for a confirmed spec.
  // A NEW "generating" row is created; the prior row (whatever its status) is NOT deleted.
  // Prior rows are retained for audit; the UI shows the latest via findLatestByPlanSpec.
  // Returns: 202 { planId: string; status: "generating" }
  // Returns: 422 if spec is missing or unconfirmed
  // Returns: 401 if not authenticated
  // Returns: 404 if spec belongs to a different tenant
  //
  // Stuck-generating strategy: manual regenerate only — no auto-sweep.
  // A user seeing indefinite "generating" status must explicitly press regenerate.
  fastify.post(
    "/plan-specs/:id/regenerate",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params as { id: string };

      const svc = generationService;
      if (!svc) {
        return reply.code(503).send({ error: "generation_service_unavailable" });
      }

      const result = await svc.startGeneration(tenantId, userId, id);
      return reply.code(202).send(result);
    }
  );

  // GET /workout-plans/:id
  // Returns a single workout plan by id, scoped to the requesting tenant.
  // Returns: 200 { id, tenantId, userId, planSpecId, status, programJson, errorMessage, createdAt, updatedAt }
  // Returns: 401 if not authenticated
  // Returns: 404 if plan not found or belongs to a different tenant
  fastify.get(
    "/workout-plans/:id",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.authContext!;
      const { id } = request.params as { id: string };

      const plan = await planRepo.findById(tenantId, id);
      if (!plan) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.code(200).send(plan);
    }
  );

  // GET /plan-specs/:id/workout-plan
  // Returns the most recently created workout plan for a given plan spec.
  // Multiple plans may exist (one per confirm/regenerate call); only the latest is returned.
  // Returns: 200 { id, status, programJson, ... }
  // Returns: 401 if not authenticated
  // Returns: 404 if no plan exists for this spec or it belongs to a different tenant
  fastify.get(
    "/plan-specs/:id/workout-plan",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.authContext!;
      const { id } = request.params as { id: string };

      const plan = await planRepo.findLatestByPlanSpec(tenantId, id);
      if (!plan) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.code(200).send(plan);
    }
  );
};
