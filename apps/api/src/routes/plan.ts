import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import {
  assertPlanSpecInput,
  assertPlanSpecShape,
  PLAN_NAME_MAX_LENGTH,
} from "../plan/boundary.js";
import { derivePreferenceScores } from "@kinora/domain";
import type { BillingFeature, PlanSpec } from "@kinora/contracts";
import type { PlanGenerationService } from "../ai/generation-service.js";
import type { ConsumeDecision } from "../billing/types.js";
import type { ChatEntitlementPort } from "../billing/chat-entitlement.js";
import type { PlanSpecExtractor } from "../ai/extraction-port.js";

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
  /**
   * Resolved plan label (#93). The app.ts adapter applies
   * `defaultPlanName(row.name, row.createdAt)` before it reaches the route, so
   * this is always a non-empty string once present. Optional here only to keep
   * legacy callers/tests compiling.
   */
  name?: string;
}

/** Lightweight plan summary for the list endpoint. */
interface PlanSummary {
  id: string;
  status: string;
  createdAt: Date;
  /** Resolved plan label (#93) — see PlanRecord.name. */
  name?: string;
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

/**
 * Billing gate for cost-bearing generation (11a). Atomically checks entitlement
 * and consumes the tenant + member quota for a feature before any expensive work
 * starts. Injected by app.ts; when absent the route does not gate (test seam —
 * production always wires the real gate, so production fails closed).
 */
export interface PlanBillingGate {
  checkAndConsume(
    scope: { tenantId: string; userId: string },
    feature: BillingFeature,
    operationKey: string,
  ): Promise<ConsumeDecision>;
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
  generationService: Pick<PlanGenerationService, "startGeneration" | "assertGeneratable">;
  /**
   * Optional billing gate. When provided, confirm/regenerate check and consume
   * quota before generation; a denial returns 403 with the denial reason and no
   * generation work is started.
   */
  billing?: PlanBillingGate;
  /**
   * Pro-only gate for the conversational chat endpoint (12, S2a). REQUIRED to
   * register `POST /plan-specs/chat` — when absent (alongside `chatExtractor`),
   * the chat route is simply not registered and existing wizard routes are
   * unaffected. The gate is fail-closed and reads identity from `authContext`.
   */
  chatEntitlement?: ChatEntitlementPort;
  /**
   * Token source for the chat endpoint's streamed assistant prose (12, S2a).
   * S2a wires a deterministic stub/Mock extractor; the real LangChain-backed
   * adapter arrives in S2b. Only `streamReply` is used here — the terminal
   * `extract()`/draft-commit path is S2b. This route NEVER imports LangChain.
   */
  chatExtractor?: Pick<PlanSpecExtractor, "streamReply">;
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
 * JSON schema for POST /plan-specs/chat body validation (12, S2a).
 *
 * Only `message` (a non-empty string) is read. `additionalProperties: true` is
 * deliberate: a spoofed `tenantId`/`tier` in the body is IGNORED, not rejected —
 * identity is resolved exclusively from `authContext`, never the body. An empty
 * or non-string message is a 400 transport error (whitespace-only handling and
 * clarifying prompts are S2b domain behavior).
 */
const chatTurnSchema = {
  body: {
    type: "object",
    required: ["message"],
    properties: {
      // Bounded well below Fastify's 1MB default body limit so an oversized
      // message is rejected with a clean 400 before any streaming/LLM work.
      message: { type: "string", minLength: 1, maxLength: 4000 },
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
  const billing = options.billing;
  const chatEntitlement = options.chatEntitlement;
  const chatExtractor = options.chatExtractor;

  /**
   * Read a client-supplied idempotency key (Idempotency-Key header), falling
   * back to a deterministic-or-fresh default. Confirm uses a deterministic key
   * so a re-confirm of the same spec is idempotent; regenerate uses a fresh key
   * so each explicit regeneration consumes its own unit.
   */
  function resolveOperationKey(request: FastifyRequest, fallback: string): string {
    const header = request.headers["idempotency-key"];
    const raw = Array.isArray(header) ? header[0] : header;
    return raw && raw.trim() !== "" ? raw.trim() : fallback;
  }

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
      > & { name?: unknown };
      const preferenceScores = derivePreferenceScores(inputSpec);
      // #93: preserve the wizard-captured plan name onto the confirmed spec so it
      // survives to the later generation request (the draft is deleted on promote,
      // so spec_json is the only durable carrier). Normalize a blank/whitespace or
      // non-string value to null — the date-based default is resolved once on READ
      // via defaultPlanName; we never default at write time.
      // Trim FIRST, then bound the trimmed length to the DB column
      // (workout_plans.name is VARCHAR(120)). An over-long name is rejected here
      // as a clean 422 — NOT allowed to reach the INSERT and blow up as a 500.
      const trimmedName =
        typeof inputSpec.name === "string" ? inputSpec.name.trim() : "";
      if (trimmedName.length > PLAN_NAME_MAX_LENGTH) {
        return reply.code(422).send({ error: "plan_name_too_long" });
      }
      const name = trimmedName !== "" ? trimmedName : null;
      const confirmedSpec: PlanSpec = {
        goal: inputSpec.goal,
        daysPerWeek: inputSpec.daysPerWeek,
        sessionDurationMinutes: inputSpec.sessionDurationMinutes,
        location: inputSpec.location,
        equipment: inputSpec.equipment,
        limitations: inputSpec.limitations,
        preferenceScores,
        confirmed: true,
        name,
      };

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

      // 11a billing: validate the spec BEFORE consuming quota. A 404/422 from
      // an invalid/nonexistent spec must never spend a unit — only a request
      // that actually reaches generation should consume (fixes a Free-tier
      // lockout where a bad :id burned the sole monthly unit).
      await generationService.assertGeneratable(tenantId, userId, id);

      if (billing) {
        const decision = await billing.checkAndConsume(
          { tenantId, userId },
          "plan_generation",
          resolveOperationKey(request, `plan_generation:${id}`),
        );
        if (!decision.allowed) {
          return reply.code(403).send({ error: decision.reason });
        }
      }

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

      // Same pre-consumption validation as confirm — see comment there.
      await generationService.assertGeneratable(tenantId, userId, id);

      if (billing) {
        const decision = await billing.checkAndConsume(
          { tenantId, userId },
          "plan_regeneration",
          resolveOperationKey(request, `plan_regeneration:${id}:${randomUUID()}`),
        );
        if (!decision.allowed) {
          return reply.code(403).send({ error: decision.reason });
        }
      }

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
          name: s.name,
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
        name: plan.name,
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
        name: plan.name,
      });
    }
  );

  // POST /plan-specs/chat  (12-interactive-text-chat, Slice 2a)
  //
  // Streaming SSE endpoint for the Asistente. S2a ships the TRANSPORT + the
  // Pro gate + the fail-closed disconnect lifecycle only, backed by a stub token
  // source. The terminal structured extraction, masking, and draft commit are
  // S2b — this handler NEVER writes a draft and NEVER imports LangChain.
  //
  // Order of operations (fail-closed):
  //   1. requireAuth        — 401 if no session (authContext is the ONLY identity)
  //   2. ChatEntitlementPort — 403 { error: reason } if not Pro, BEFORE any
  //                            streaming/LLM work or reply.hijack()
  //   3. reply.hijack() + SSE headers on reply.raw
  //   4. stream `token` deltas from the injected extractor, then a terminal
  //      `done` event (S2b replaces `done` with `draft`/`error`)
  //
  // Client disconnect: `request.raw` "close" fires an AbortController; the
  // extractor stops (it honors the signal) and the response ends — no orphaned
  // work, no draft write. Chat consumes NO billing quota.
  //
  // Registered only when BOTH the gate and the extractor are wired (they are, in
  // app.ts). Absent them the wizard routes above are entirely unaffected.
  if (chatEntitlement && chatExtractor) {
    fastify.post(
      "/plan-specs/chat",
      { schema: chatTurnSchema, preHandler: requireAuth() },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { tenantId, userId } = request.authContext!;

        // Pro gate — fail-closed BEFORE any streaming/LLM work or hijack. A
        // denial is a plain JSON 403, exactly like confirm/regenerate.
        const decision = await chatEntitlement.check({ tenantId, userId });
        if (!decision.allowed) {
          return reply.code(403).send({ error: decision.reason ?? "premium_required" });
        }

        const { message } = request.body as { message: string };

        // Take over the response: write SSE frames directly to the raw socket.
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          // Defeat proxy/CDN buffering so tokens flush incrementally.
          "X-Accel-Buffering": "no",
        });

        // Client disconnect → abort the extractor and stop emitting. Listen on
        // BOTH the request and the response raw sockets: depending on the client
        // and keep-alive, a mid-stream disconnect surfaces as a "close" on the
        // response socket (the SSE body) and/or the request. AbortController is
        // idempotent, so a double-fire is harmless; listeners are removed in
        // `finally`.
        const controller = new AbortController();
        const onClose = () => controller.abort();
        request.raw.on("close", onClose);
        raw.on("close", onClose);

        // CRITICAL: a mid-stream socket-level failure (e.g. a client TCP RESET
        // → ECONNRESET) fires an 'error' event on the hijacked `reply.raw` (and
        // possibly its underlying socket). Node re-throws an unhandled 'error'
        // event as an UNCAUGHT EXCEPTION that crashes the ENTIRE process — every
        // tenant, not just this request. Treat it exactly like a disconnect:
        // log it, abort, and never rethrow. Listen on both the response object
        // and its socket since either can be the emitter depending on where the
        // failure originates.
        const onError = (err: unknown) => {
          request.log.error({ err, tenantId, userId }, "chat stream socket error");
          controller.abort();
        };
        raw.on("error", onError);
        raw.socket?.on("error", onError);

        const write = (event: string, data: unknown): void => {
          // Never write to an aborted/ended socket — that throws ERR_STREAM_*.
          if (controller.signal.aborted || raw.writableEnded) return;
          raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          // S2a stub: currentDraft is empty — the shared-draft read/merge is S2b.
          const input = { message, currentDraft: {} };
          for await (const token of chatExtractor.streamReply(input, controller.signal)) {
            if (controller.signal.aborted) break;
            write("token", { delta: token });
          }
          // Terminal stub event. S2b emits `draft` (with the merged spec) or
          // `error` here; S2a has no extraction/merge/commit yet.
          write("done", {});
        } catch (error) {
          // A stub-source failure is surfaced as a terminal `error`; no draft is
          // ever written in S2a regardless. Log with tenant/user correlation
          // (from authContext, never the body) so a failing stream is
          // diagnosable in prod — the client-facing event stays generic (no
          // stack/internal detail).
          request.log.error({ err: error, tenantId, userId }, "chat stream failed");
          write("error", { error: "chat_stream_failed" });
        } finally {
          request.raw.removeListener("close", onClose);
          raw.removeListener("close", onClose);
          raw.removeListener("error", onError);
          raw.socket?.removeListener("error", onError);
          if (!raw.writableEnded) raw.end();
        }
      }
    );
  }
};
