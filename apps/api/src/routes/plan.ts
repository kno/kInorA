import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { assertPlanSpecInput, assertPlanSpecShape } from "../plan/boundary.js";
import { derivePreferenceScores } from "@kinora/domain";
import type { PlanSpec } from "@kinora/contracts";
import type { PlanGenerationService } from "../ai/generation-service.js";

/**
 * A workout plan record as returned to the route (structural shape, declared
 * inline so the route layer never imports the DB layer). Mirrors the fields the
 * route maps into the client DTO.
 */
interface PlanRecord {
  id: string;
  status: string;
  programJson?: unknown;
  planSpecId: string;
}

/** Lightweight plan summary for the list endpoint. */
interface PlanSummary {
  id: string;
  status: string;
  createdAt: Date;
}

/**
 * Route port for the plan wizard + generation endpoints. Encapsulates the
 * draft/spec/plan reads and — critically — the cross-repo atomic promote
 * (promoteDraftToSpec), whose db.transaction lives in the app.ts adapter. The
 * route calls only these methods and never touches the DB layer or a
 * transaction primitive.
 */
export interface PlanRouteRepo {
  upsertDraft(
    tenantId: string,
    userId: string,
    step: number,
    spec: Partial<PlanSpec>
  ): Promise<{ step: number; specJson: unknown }>;
  findCurrentDraft(
    tenantId: string,
    userId: string
  ): Promise<{ step: number; specJson: unknown } | null>;
  /** Atomic: insert confirmed spec + delete draft in ONE db.transaction (owned by app.ts). */
  promoteDraftToSpec(
    tenantId: string,
    userId: string,
    spec: PlanSpec
  ): Promise<{ id: string; spec: PlanSpec }>;
  findPlanById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<PlanRecord | undefined>;
  findLatestPlanBySpec(
    tenantId: string,
    userId: string,
    specId: string
  ): Promise<PlanRecord | undefined>;
  findAllPlansByUser(tenantId: string, userId: string): Promise<PlanSummary[]>;
}

export interface PlanRoutesOptions {
  /**
   * Route port — constructed in app.ts (the sole composition root). Encapsulates
   * all draft/spec/plan persistence and the atomic promote transaction.
   */
  repo: PlanRouteRepo;
  /**
   * Generation service — REQUIRED. Provide a real PlanGenerationService in
   * production (wired in buildApp) or a MockPlanGenerator-backed instance in tests.
   * The plugin throws at registration time if this is absent, so misconfiguration
   * is caught at boot, not at the first request.
   */
  generationService: Pick<PlanGenerationService, "startGeneration">;
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
 *   GET  /workout-plans/:id             — fetch a plan by id (tenant + user scoped)
 *   GET  /plan-specs/:id/workout-plan   — fetch the latest plan for a spec (tenant + user scoped)
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
  const { repo } = options;

  // Assert DI contract at registration time — fail fast if the caller forgot to wire the service.
  if (!options.generationService) {
    throw new Error("generationService is required for plan generation routes");
  }

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

      const draft = await repo.upsertDraft(tenantId, userId, body.step, body.spec);
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

      const draft = await repo.findCurrentDraft(tenantId, userId);
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

      const draft = await repo.findCurrentDraft(tenantId, userId);
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

      // Insert the confirmed plan_specs row and delete the draft atomically.
      // The single db.transaction wrapping both writes is owned by the app.ts
      // adapter behind this port method — the route never sees a transaction.
      const result = await repo.promoteDraftToSpec(tenantId, userId, confirmedSpec);

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

      const result = await generationService.startGeneration(tenantId, userId, id);
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

      const result = await generationService.startGeneration(tenantId, userId, id);
      return reply.code(202).send(result);
    }
  );

  // GET /workout-plans
  // Returns all workout plan summaries for the authenticated user within their tenant.
  // Ordered newest-first (createdAt DESC). Returns [] when no plans exist.
  // Returns: 200 Array<{ id, status, createdAt }> — newest first; [] when none
  // Returns: 401 if not authenticated
  fastify.get(
    "/workout-plans",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const summaries = await repo.findAllPlansByUser(tenantId, userId);
      return reply.code(200).send(
        summaries.map((s) => ({
          id: s.id,
          status: s.status,
          createdAt: s.createdAt,
        }))
      );
    }
  );

  // GET /workout-plans/:id
  // Returns a single workout plan by id, scoped to the requesting tenant + user.
  // Returns: 200 { id, status, program, specId }
  // Returns: 401 if not authenticated
  // Returns: 404 if plan not found, belongs to a different tenant, or belongs to a
  //           different user within the same tenant (same-tenant cross-user isolation)
  fastify.get(
    "/workout-plans/:id",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params as { id: string };

      const plan = await repo.findPlanById(tenantId, userId, id);
      if (!plan) {
        return reply.code(404).send({ error: "not_found" });
      }
      // Map to the client DTO: the web reads { id, status, program, specId }.
      // Do NOT return the raw DB row — its field names (programJson/planSpecId)
      // differ from the client contract and it carries internal columns
      // (tenantId/userId/errorMessage) that must not leak to the client.
      return reply.code(200).send({
        id: plan.id,
        status: plan.status,
        program: plan.programJson ?? undefined,
        specId: plan.planSpecId,
      });
    }
  );

  // GET /plan-specs/:id/workout-plan
  // Returns the most recently created workout plan for a given plan spec.
  // Multiple plans may exist (one per confirm/regenerate call); only the latest is returned.
  // Scoped to the requesting tenant + user — same-tenant cross-user reads return 404.
  // Returns: 200 { id, status, program, specId }
  // Returns: 401 if not authenticated
  // Returns: 404 if no plan exists for this spec, belongs to a different tenant, or belongs
  //           to a different user within the same tenant
  fastify.get(
    "/plan-specs/:id/workout-plan",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId, userId } = request.authContext!;
      const { id } = request.params as { id: string };

      const plan = await repo.findLatestPlanBySpec(tenantId, userId, id);
      if (!plan) {
        return reply.code(404).send({ error: "not_found" });
      }
      // Map to the client DTO (see GET /workout-plans/:id above): client reads
      // { id, status, program, specId } — not the raw DB row.
      return reply.code(200).send({
        id: plan.id,
        status: plan.status,
        program: plan.programJson ?? undefined,
        specId: plan.planSpecId,
      });
    }
  );
};
