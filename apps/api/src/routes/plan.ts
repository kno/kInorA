import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { requireAuth } from "../auth/plugin.js";
import {
  assertPlanSpecInput,
  assertPlanSpecShape,
  PLAN_NAME_MAX_LENGTH,
} from "../plan/boundary.js";
import { derivePreferenceScores } from "@kinora/domain";
import { mergePlanSpecDraft } from "@kinora/domain/plan";
import type { BillingFeature, PlanSpec, PlanSpecDraft } from "@kinora/contracts";
import type { PlanGenerationService } from "../ai/generation-service.js";
import type { ConsumeDecision } from "../billing/types.js";
import type { ChatEntitlementPort } from "../billing/chat-entitlement.js";
import type { PlanSpecExtractor } from "../ai/extraction-port.js";
import type { SpeechTranscriber } from "../ai/speech-transcriber-port.js";
import type { SpeechSynthesizer } from "../ai/speech-synthesizer-port.js";

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
   * Extractor for the chat endpoint (12, S2b). Both passes are used now:
   * `streamReply` for the assistant prose and `extract` for the terminal
   * structured `Partial<PlanSpec>`. The route depends ONLY on this port — the
   * LangChain dependency lives entirely inside the injected adapter
   * (`ai/extraction-adapter.ts`), so the route never imports LangChain.
   */
  chatExtractor?: PlanSpecExtractor;
  /**
   * Wall-clock deadline (ms) for a single chat turn (12, S2b). If Pass 1/Pass 2
   * do not complete within this budget the turn is aborted (LLM stream cancelled
   * via the shared AbortSignal), a terminal `error` event is emitted, and the
   * socket is closed cleanly with NO draft write. Defaults to 60s. Injected
   * small in tests for deterministic timeout coverage.
   */
  chatStreamTimeoutMs?: number;
  /**
   * Speech-to-text port for `POST /plan-specs/transcribe`
   * (13-v1.1-interactive-voice-chat, A2). REQUIRED (alongside `chatEntitlement`)
   * to register the transcribe route — when absent the route is simply not
   * registered and every wizard/chat route is unaffected. The route depends ONLY
   * on this port; the `openai` SDK lives entirely in the injected adapter
   * (`ai/openai-audio-adapter.ts`), so the route never imports it. Tests inject a
   * deterministic `MockSpeechTranscriber` (or any fake).
   */
  transcriber?: SpeechTranscriber;
  /**
   * Text-to-speech port for `POST /plan-specs/speech`
   * (13-v1.1-interactive-voice-chat, A3). REQUIRED (alongside `chatEntitlement`
   * and `voicePreferences`) to register the speech route — when absent the route
   * is simply not registered and every wizard/chat/transcribe route is
   * unaffected. The route depends ONLY on this port; the `openai` SDK lives
   * entirely in the injected adapter (`ai/openai-audio-adapter.ts`), so the route
   * never imports it. Tests inject a deterministic `MockSpeechSynthesizer`.
   */
  synthesizer?: SpeechSynthesizer;
  /**
   * Reader for the authenticated user's TTS opt-out preference (A3). Resolves
   * `tts_enabled` from `user_preferences`: `null`/`true` → enabled (opt-out
   * default ON); `false` → opted out (the speech route returns 204 and never
   * calls the synthesizer). Injected by app.ts from the preferences repo; the
   * route reads it ONLY for the authenticated `userId` from `authContext`.
   */
  voicePreferences?: VoicePreferenceReader;
}

/**
 * Narrow reader port for the TTS opt-out preference (A3). Returns the stored
 * `tts_enabled` flag for a user, or `null` when unset (treated as enabled).
 */
export interface VoicePreferenceReader {
  findTtsEnabled(userId: string): Promise<boolean | null>;
}

/** Default per-turn chat stream deadline (ms). */
const DEFAULT_CHAT_STREAM_TIMEOUT_MS = 60_000;

/**
 * Audio upload caps for `POST /plan-specs/transcribe` (13, A2 — design.md
 * "Audio caps"). Enforced SERVER-SIDE before any OpenAI call: byte size is the
 * hard gate (duration would require decoding), and the content type must be one
 * of the recorder-produced container formats. A client-side cap is advisory only.
 */
const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Allow-listed audio container content types (design.md): Chrome/Firefox opus
 * (`audio/webm`), Safari / iOS PWA (`audio/mp4`, `audio/x-m4a`), Expo RN
 * (`audio/m4a`), plus `audio/mpeg` and `audio/wav`. Anything else → 415 BEFORE
 * any transcription.
 */
const ALLOWED_AUDIO_TYPES = new Set<string>([
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/mpeg",
  "audio/wav",
]);

/**
 * TTS input character cap for `POST /plan-specs/speech` (13, A3 — design.md
 * "OpenAI's ~4096-char cap"). The route bounds the input defensively BEFORE any
 * OpenAI call; the adapter additionally truncates at a sentence boundary. A
 * create-plan terminal reply is short, so this is a guard, not a common path.
 */
const MAX_TTS_INPUT_CHARS = 4096;

/**
 * Structurally compare two drafts over the allow-listed fields to decide whether
 * the merge actually changed anything. A turn that extracts nothing (or only
 * invalid values dropped by `mergePlanSpecDraft`) MUST NOT write the draft —
 * this keeps an empty/no-op turn from touching `plan_drafts` at all.
 */
function draftChanged(next: PlanSpecDraft, prev: PlanSpecDraft): boolean {
  const fields = [
    "goal",
    "daysPerWeek",
    "sessionDurationMinutes",
    "location",
    "equipment",
    "limitations",
    "name",
  ] as const;
  return fields.some(
    (f) => JSON.stringify(next[f] ?? null) !== JSON.stringify(prev[f] ?? null),
  );
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
 * JSON schema for POST /plan-specs/speech body validation (13, A3).
 *
 * Only `text` (a non-empty string) is read. `additionalProperties: true` is
 * deliberate: a spoofed `tenantId`/`tier` in the body is IGNORED — identity is
 * resolved exclusively from `authContext`, never the body. An over-cap `text`
 * is NOT rejected here; the handler truncates it to the OpenAI cap before any
 * TTS call. The generous `maxLength` only guards against an absurd payload.
 */
const speechSchema = {
  body: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string", minLength: 1, maxLength: 100_000 },
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
  const transcriber = options.transcriber;
  const synthesizer = options.synthesizer;
  const voicePreferences = options.voicePreferences;

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

  // POST /plan-specs/chat  (12-interactive-text-chat, Slice 2b)
  //
  // Streaming SSE endpoint for the Asistente. S2b completes the turn: it streams
  // the assistant prose (Pass 1), runs the terminal structured extraction
  // (Pass 2), merges the result onto the SHARED `plan_drafts` draft via the pure
  // `mergePlanSpecDraft`, commits the draft ONLY on the terminal event, and emits
  // a terminal `draft { draftSpec, missingFields, assistantMessage }`. Any
  // mid-stream failure emits a terminal `error` and leaves the draft untouched.
  // The route depends ONLY on the `PlanSpecExtractor` port — LangChain lives in
  // the injected adapter, never here (deps-guard/architecture confinement).
  //
  // Order of operations (fail-closed):
  //   1. requireAuth        — 401 if no session (authContext is the ONLY identity)
  //   2. ChatEntitlementPort — 403 { error: reason } if not Pro, BEFORE any
  //                            streaming/LLM work or reply.hijack()
  //   3. reply.hijack() + SSE headers on reply.raw
  //   4. read the current shared draft (tenant/user scoped, from authContext)
  //   5. empty/whitespace message → NO LLM work; a clarifying terminal `draft`
  //      carrying the UNCHANGED draft (no write)
  //   6. otherwise Pass 1 stream `token` deltas → Pass 2 `extract` → merge →
  //      commit-if-changed → terminal `draft`
  //
  // Resilience: a shared AbortController is fired by (a) client disconnect
  // (`close` on request/response), (b) a socket-level error (ECONNRESET), and
  // (c) a wall-clock timeout. On disconnect/error NO terminal event is written
  // (the client is gone); on timeout a terminal `error` is written to the still
  // open socket. `writeFrame` honors backpressure: when the kernel buffer is
  // full (`raw.write()` returns false) it awaits `drain` before continuing so no
  // token is dropped. Chat consumes NO billing quota and performs NO vector
  // embedding of the transcript.
  //
  // Registered only when BOTH the gate and the extractor are wired (they are, in
  // app.ts). Absent them the wizard routes above are entirely unaffected.
  if (chatEntitlement && chatExtractor) {
    const chatExtractorPort = chatExtractor;
    const timeoutMs = options.chatStreamTimeoutMs ?? DEFAULT_CHAT_STREAM_TIMEOUT_MS;
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

        // Client disconnect → abort the extractor and stop emitting. `clientGone`
        // gates the terminal write: once the client has disconnected (or the
        // socket errored) we must NOT attempt any further write. `timedOut`
        // records a wall-clock deadline breach so we DO emit a terminal `error`
        // on the still-open socket. Listen on BOTH request and response sockets.
        const controller = new AbortController();
        let clientGone = false;
        let timedOut = false;
        const onClose = () => {
          clientGone = true;
          controller.abort();
        };
        request.raw.on("close", onClose);
        raw.on("close", onClose);

        // CRITICAL: a mid-stream socket-level failure (e.g. a client TCP RESET
        // → ECONNRESET) fires an 'error' event on the hijacked `reply.raw` (and
        // possibly its underlying socket). An unhandled 'error' event crashes the
        // ENTIRE process. Treat it as a disconnect: log, mark the client gone,
        // abort, and never rethrow.
        const onError = (err: unknown) => {
          request.log.error({ err, tenantId, userId }, "chat stream socket error");
          clientGone = true;
          controller.abort();
        };
        raw.on("error", onError);
        raw.socket?.on("error", onError);

        // Wall-clock deadline: on breach abort the LLM stream and mark timedOut so
        // a terminal `error` is emitted before the clean close.
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);

        // Backpressure-aware write. When `raw.write()` returns false the kernel
        // send buffer is full — await 'drain' before continuing so no token is
        // lost. `clientGone` (not `signal.aborted`) gates the INITIAL write so a
        // timeout can still flush its terminal `error` to the open socket.
        //
        // HANG FIX: the drain wait previously escaped ONLY via `abort`. Two gaps:
        // (a) if the signal was ALREADY aborted before this call (e.g. the
        //     timeout's own terminal-error write), the `addEventListener("abort")`
        //     listener never fires because the event already happened — bail
        //     immediately instead of registering a listener that will never see
        //     the transition. (b) if 'drain' never arrives (a stalled/dead
        //     socket — the very condition that caused the timeout) and nothing
        //     else escapes, the promise hangs forever, leaking the handler and
        //     the socket (it never reaches `finally`/`raw.end()`). Race 'drain'
        //     against 'close'/'error' on `raw` as well as `abort`, and always
        //     remove every listener on settle.
        const writeFrame = (event: string, data: unknown): Promise<void> => {
          if (clientGone || raw.writableEnded) return Promise.resolve();
          const ok = raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          if (ok) return Promise.resolve();
          // Already aborted by the time we'd wait — bail without registering a
          // listener for an event that already fired.
          if (controller.signal.aborted) return Promise.resolve();
          return new Promise<void>((resolve) => {
            const cleanup = () => {
              raw.removeListener("drain", settle);
              raw.removeListener("close", settle);
              raw.removeListener("error", settle);
              controller.signal.removeEventListener("abort", settle);
            };
            const settle = () => {
              cleanup();
              resolve();
            };
            raw.once("drain", settle);
            raw.once("close", settle);
            raw.once("error", settle);
            controller.signal.addEventListener("abort", settle, { once: true });
          });
        };

        try {
          // Shared draft: read the tenant/user-scoped `plan_drafts` state (never
          // the body). A missing draft is an empty draft.
          //
          // TODO(S3): two concurrent/overlapping chat turns for the same
          // tenant+user (e.g. a fast double-submit) can both read the SAME
          // `currentDraft` here and the second commit's `upsertDraft` can
          // overwrite the first turn's merged fields (a lost update — WARNING,
          // not fixed in S2b). Mitigation lands in S3 by serializing chat turns
          // client-side (disable submit while a turn is in flight); no
          // server-side locking is added here.
          const currentRow = await repo.findCurrentDraft(tenantId, userId);
          const currentDraft = (currentRow?.specJson ?? {}) as PlanSpecDraft;
          const step = currentRow?.step ?? 1;

          // Empty/whitespace message → NO LLM work (spec: draft unchanged, a
          // clarifying prompt only). Emit the current draft + its missingFields
          // as the terminal event without any extractor call or draft write.
          if (message.trim() === "") {
            const { draft, missingFields } = mergePlanSpecDraft(currentDraft, {});
            await writeFrame("draft", {
              draftSpec: draft,
              missingFields,
              assistantMessage:
                "Tell me about the plan you want — your goal, how many days per week, session length, where you train, and any equipment.",
            });
            return;
          }

          // Compute the still-missing input fields from the CURRENT draft
          // (reusing the same canonical merge logic against an empty
          // extraction) so the extractor can steer its prose/extraction toward
          // a deterministic clarifying question, exactly like S1's
          // `buildExtractionPrompt` was designed to receive.
          const { missingFields: currentMissingFields } = mergePlanSpecDraft(currentDraft, {});
          const input = { message, currentDraft, missingFields: currentMissingFields };

          // Pass 1 — stream the assistant prose token-by-token, accumulating it
          // for the terminal event.
          let assistantMessage = "";
          for await (const token of chatExtractorPort.streamReply(input, controller.signal)) {
            if (controller.signal.aborted) break;
            assistantMessage += token;
            await writeFrame("token", { delta: token });
          }

          // Aborted mid Pass 1: client disconnect → silent; timeout → terminal error.
          if (controller.signal.aborted) {
            if (timedOut) await writeFrame("error", { error: "chat_stream_timeout" });
            return;
          }

          // Pass 2 — terminal structured extraction (non-streamed). Threads the
          // SAME AbortSignal so a timeout/disconnect firing during this call
          // cancels the in-flight structured-output request (HIGH fix — Pass 2
          // was previously uncancellable).
          const extracted = await chatExtractorPort.extract(input, controller.signal);

          if (controller.signal.aborted) {
            if (timedOut) await writeFrame("error", { error: "chat_stream_timeout" });
            return;
          }

          // Merge (pure domain, re-validates every field) and compute missing.
          const { draft: mergedDraft, missingFields } = mergePlanSpecDraft(currentDraft, extracted);

          // Commit ONLY here, ONLY when the turn actually changed the draft. A
          // no-op/empty extraction never touches `plan_drafts`.
          if (draftChanged(mergedDraft, currentDraft)) {
            await repo.upsertDraft(tenantId, userId, step, mergedDraft);
          }

          await writeFrame("draft", {
            draftSpec: mergedDraft,
            missingFields,
            assistantMessage,
          });
        } catch (error) {
          // Any Pass 1/Pass 2 failure fails CLOSED: terminal `error`, draft
          // untouched (upsertDraft is only reached on the success path above).
          // A client-gone stream gets no terminal write. Log with tenant/user
          // correlation (authContext, never the body); the client event stays
          // generic (no stack/internal detail).
          //
          // A timed-out Pass 2 rejects (its signal aborted mid-`await`) and
          // lands HERE rather than at the post-await `controller.signal.aborted`
          // check below Pass 2 — surface it as the same `chat_stream_timeout`
          // terminal, not the generic `chat_stream_failed`.
          request.log.error({ err: error, tenantId, userId }, "chat stream failed");
          if (!clientGone) {
            const reason = timedOut ? "chat_stream_timeout" : "chat_stream_failed";
            await writeFrame("error", { error: reason });
          }
        } finally {
          clearTimeout(timer);
          request.raw.removeListener("close", onClose);
          raw.removeListener("close", onClose);
          raw.removeListener("error", onError);
          raw.socket?.removeListener("error", onError);
          if (!raw.writableEnded) raw.end();
        }
      }
    );
  }

  // POST /plan-specs/transcribe  (13-v1.1-interactive-voice-chat, A2)
  //
  // Speech-to-text for the voice companion. The client records a short
  // push-to-talk clip and uploads it multipart; this route returns
  // `{ text, unclear }`, which the client then feeds into the EXISTING
  // `/plan-specs/chat` turn unchanged. It consumes NO billing quota and NEVER
  // persists the audio — the bytes exist in-flight only and are never written to
  // any repository, disk, or log.
  //
  // Order of operations (fail-closed, mirrors the chat route):
  //   1. requireAuth               — 401 if no session (authContext is the ONLY
  //                                  identity; a body-injected tenant/tier is
  //                                  ignored)
  //   2. ChatEntitlementPort.check — 403 { error: reason } if not Pro, BEFORE any
  //                                  multipart parsing or transcription work. A
  //                                  THROW in the check is an infra failure, NOT
  //                                  a denial decision — it propagates to a 5xx
  //                                  (never mislabeled as premium_required), and
  //                                  the transcriber is still never reached.
  //   3. content-type ∈ allow-list — 415 unsupported_audio_format (before OpenAI)
  //   4. size ≤ 15 MB              — 413 (before OpenAI); empty/missing → 400
  //   5. SpeechTranscriber.transcribe(bytes, signal) — whisper-1 in the adapter;
  //      empty/whitespace transcript → 200 { text:"", unclear:true } (silence is
  //      a normal event, never a 5xx); a transport failure → 502
  //      transcription_failed (generic — no provider detail/stack leaked).
  //
  // Multipart is registered in an ENCAPSULATED child scope so its content-type
  // parser + 15 MB bodyLimit apply ONLY here — the JSON chat/wizard routes above
  // keep the default parser and 1 MB limit. Registered only when BOTH the gate
  // and the transcriber are wired (they are, in app.ts). Absent them the wizard
  // and chat routes are entirely unaffected.
  if (chatEntitlement && transcriber) {
    const gate = chatEntitlement;
    const speechTranscriber = transcriber;
    await fastify.register(async (scope) => {
      await scope.register(fastifyMultipart, {
        // Hard byte cap: a file exceeding this is truncated and toBuffer() throws
        // FST_REQ_FILE_TOO_LARGE, mapped to 413. A single audio part only.
        limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
      });

      scope.post(
        "/plan-specs/transcribe",
        { preHandler: requireAuth() },
        async (request: FastifyRequest, reply: FastifyReply) => {
          const { tenantId, userId } = request.authContext!;

          // Pro gate — fail-closed BEFORE any multipart parsing / transcription.
          // Identity comes ONLY from authContext; a spoofed body cannot influence
          // it.
          //
          // Distinguish a genuine DENY DECISION from a CHECK FAILURE (review
          // fix): a resolved `{allowed:false}` is a real entitlement denial → 403
          // with the specific reason, exactly like the chat route. A THROW from
          // the reader is an infra/outage failure, NOT a payment decision —
          // reporting it as `premium_required` would mislabel a transient
          // entitlement-reader/DB outage as "you must upgrade" to a paying Pro
          // user and would mask the outage from 5xx alerting. Still fail-closed
          // (the transcriber is NEVER reached), but surfaced as a 5xx like the
          // chat route's uncaught-throw convention — let it propagate to
          // Fastify's error handler (500) instead of a synthetic 403.
          const decision = await gate.check({ tenantId, userId });
          if (!decision.allowed) {
            return reply.code(403).send({ error: decision.reason ?? "premium_required" });
          }

          // Read the single audio part. `request.file()` surfaces the part header
          // (mimetype) without consuming the whole stream, so the allow-list is
          // checked BEFORE the bytes are read into memory.
          let filePart: Awaited<ReturnType<typeof request.file>>;
          try {
            filePart = await request.file();
          } catch {
            return reply.code(400).send({ error: "invalid_audio_upload" });
          }
          if (!filePart) {
            return reply.code(400).send({ error: "missing_audio" });
          }

          const contentType = filePart.mimetype;
          if (!ALLOWED_AUDIO_TYPES.has(contentType)) {
            // Review fix: `request.file()` only reads the part HEADER — the file
            // stream itself is still unconsumed. Rejecting here without draining
            // it leaves a large disallowed-type upload's bytes sitting on the
            // socket; the client then sees an abrupt ECONNRESET/EPIPE instead of
            // the clean 415. Resume (drain) the stream before replying so the
            // connection closes cleanly.
            filePart.file.resume();
            return reply.code(415).send({ error: "unsupported_audio_format" });
          }

          // Read the bytes with the 15 MB hard cap. An over-cap upload is
          // truncated by @fastify/multipart and toBuffer() throws
          // FST_REQ_FILE_TOO_LARGE → 413, BEFORE any OpenAI call. Never log the
          // raw audio.
          let audio: Buffer;
          try {
            audio = await filePart.toBuffer();
          } catch {
            return reply.code(413).send({ error: "audio_too_large" });
          }
          if (filePart.file.truncated || audio.byteLength > MAX_AUDIO_BYTES) {
            return reply.code(413).send({ error: "audio_too_large" });
          }
          if (audio.byteLength === 0) {
            return reply.code(400).send({ error: "missing_audio" });
          }

          // Abort the in-flight transcription if the client disconnects. The
          // audio is processed in-flight ONLY — never persisted anywhere.
          const controller = new AbortController();
          const onClose = () => controller.abort();
          request.raw.on("close", onClose);

          try {
            const result = await speechTranscriber.transcribe(
              { audio: new Uint8Array(audio), contentType },
              controller.signal,
            );
            // Silence/noise → a graceful 200 { text:"", unclear:true }, NOT a 5xx.
            return reply.code(200).send({ text: result.text, unclear: result.unclear });
          } catch (error) {
            // A transport/provider failure maps to a generic 502 — the provider's
            // message/stack is logged server-side (tenant/user correlation only,
            // never the audio or transcript) and NEVER returned to the client.
            request.log.error({ err: error, tenantId, userId }, "transcription failed");
            return reply.code(502).send({ error: "transcription_failed" });
          } finally {
            request.raw.removeListener("close", onClose);
          }
        },
      );
    });
  }

  // POST /plan-specs/speech  (13-v1.1-interactive-voice-chat, A3)
  //
  // Text-to-speech for the voice companion. The client sends the terminal
  // `assistantMessage` text and this route returns mp3 audio bytes for
  // after-turn playback. It consumes NO billing quota and NEVER persists the
  // generated audio — the bytes exist in-flight only and are never written to
  // any repository, disk, or log.
  //
  // Order of operations (fail-closed, mirrors the transcribe route):
  //   1. requireAuth               — 401 if no session (authContext is the ONLY
  //                                  identity; a body-injected tenant/tier is
  //                                  ignored)
  //   2. ChatEntitlementPort.check — 403 { error: reason } if not Pro, BEFORE any
  //                                  preference read or TTS work. A THROW in the
  //                                  check is an infra failure, NOT a denial
  //                                  decision — it propagates to a 5xx (never
  //                                  mislabeled as premium_required), and the
  //                                  synthesizer is still never reached.
  //   3. resolve tts_enabled       — `false` → 204 No Content (opted out; the
  //                                  synthesizer is NEVER called). `null`/`true`
  //                                  → proceed (opt-out default is ON).
  //   4. truncate text to the cap  — bound to MAX_TTS_INPUT_CHARS BEFORE the call.
  //   5. SpeechSynthesizer.synthesize(text, signal) — gpt-4o-mini-tts/mp3 in the
  //      adapter; a transport failure → 502 synthesis_failed (generic — no
  //      provider detail/stack leaked). On success → 200 audio/mpeg body.
  //
  // JSON body (default parser); registered only when the gate, synthesizer, and
  // preference reader are ALL wired (they are, in app.ts). Absent them the
  // wizard/chat/transcribe routes are entirely unaffected.
  if (chatEntitlement && synthesizer && voicePreferences) {
    const gate = chatEntitlement;
    const speechSynthesizer = synthesizer;
    const prefs = voicePreferences;

    fastify.post(
      "/plan-specs/speech",
      { schema: speechSchema, preHandler: requireAuth() },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { tenantId, userId } = request.authContext!;

        // Pro gate — fail-closed BEFORE any preference read / TTS work. Identity
        // comes ONLY from authContext. A resolved `{allowed:false}` is a genuine
        // denial → 403 with the reason; a THROW is an infra failure that
        // propagates to a 5xx (never mislabeled as premium_required), exactly
        // like the transcribe/chat routes.
        const decision = await gate.check({ tenantId, userId });
        if (!decision.allowed) {
          return reply.code(403).send({ error: decision.reason ?? "premium_required" });
        }

        // Resolve the caller's opt-out preference. `false` = opted out → 204 and
        // the synthesizer is NEVER called. `null`/`true` = enabled (default ON).
        const ttsEnabled = await prefs.findTtsEnabled(userId);
        if (ttsEnabled === false) {
          return reply.code(204).send();
        }

        const body = request.body as { text: string };
        // Bound the input to the OpenAI cap BEFORE any TTS call. The adapter also
        // truncates at a sentence boundary; this is the route-level guard.
        const text = body.text.slice(0, MAX_TTS_INPUT_CHARS);

        // Abort the in-flight synthesis if the client disconnects. The audio is
        // processed in-flight ONLY — never persisted anywhere.
        const controller = new AbortController();
        const onClose = () => controller.abort();
        request.raw.on("close", onClose);

        try {
          const result = await speechSynthesizer.synthesize(text, controller.signal);
          return reply
            .code(200)
            .header("content-type", result.contentType)
            .send(Buffer.from(result.audio));
        } catch (error) {
          // A transport/provider failure maps to a generic 502 — the provider's
          // message/stack is logged server-side (tenant/user correlation only,
          // never the text or key) and NEVER returned to the client.
          request.log.error({ err: error, tenantId, userId }, "synthesis failed");
          return reply.code(502).send({ error: "synthesis_failed" });
        } finally {
          request.raw.removeListener("close", onClose);
        }
      },
    );
  }
};
