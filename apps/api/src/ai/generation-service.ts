import type { PlanGenerator } from "./port.js";
import type { WorkoutPlanRepository } from "../db/repositories/workout-plan.js";
import type { PlanSpecRepository } from "../db/repositories/plan-spec.js";
import type { VectorMemoryRecord } from "../db/repositories/vector-memory.js";
import type { MemoryRetrievalEntitlementPort } from "./memory-retriever.js";
import type { WsRegistry } from "../ws/registry.js";
import type { ObservabilityLogger } from "../observability/event-logger.js";
import { mask } from "./mask.js";
import { capVocabularyForPrompt, resolveExerciseVocabulary } from "./exercise-vocabulary.js";
import { resolveProgramCatalogIds } from "./catalog-resolution.js";
import { assertPlanSpecShape } from "../plan/boundary.js";
import type { BodyProfilePromptInput } from "./prompt.js";
import type { SelfDescribedSex } from "@kinora/contracts";
import {
  injectLimitationWarnings,
  assertNoDiagnosticLanguage,
  normalizeProgramReps,
} from "@kinora/domain";
import type { WarningLocale } from "@kinora/domain";

/**
 * The minimal profile-row shape `attachBodyProfile` needs (17c-profile-body-
 * metrics, PR 3) — satisfied by `UserProfileRepository.findByUserId`'s
 * resolved value without importing the concrete repository class here.
 */
interface BodyProfileSourceRow {
  selfDescribedSex: SelfDescribedSex | null;
  heightCm: number | null;
}

/** Reads the current profile row for a user. `null` when no row exists. */
interface UserProfilePort {
  findByUserId(userId: string): Promise<BodyProfileSourceRow | null>;
}

/** Reads a user's bodyweight readings, newest first. */
interface WeightEntryPort {
  list(userId: string): Promise<{ weightKg: number }[]>;
}

/**
 * 404-class error: spec not found or belongs to a different tenant.
 * Used by the route layer to respond 404 without conflating with shape errors.
 */
export class PlanSpecNotFoundError extends Error {
  statusCode = 404;
  constructor(planSpecId: string) {
    super(`PlanSpec not found or unconfirmed: ${planSpecId}`);
    this.name = "PlanSpecNotFoundError";
  }
}

/**
 * 422-class error: spec shape is invalid (boundary guard failure).
 * This indicates a server-side data integrity issue (spec was persisted without
 * passing assertPlanSpecShape), not a client error.
 */
export class PlanSpecShapeError extends Error {
  statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = "PlanSpecShapeError";
  }
}

/**
 * Generation service — orchestrates the async workout plan creation pipeline.
 *
 * Lifecycle:
 * 1. Load the confirmed PlanSpec via PlanSpecRepository.findConfirmedById.
 *    If missing or unconfirmed → throws PlanSpecNotFoundError (404-class).
 * 2. Validate the spec shape via assertPlanSpecShape (boundary guard).
 *    If invalid → throws PlanSpecShapeError (422-class).
 * 3. Create a "generating" row in WorkoutPlanRepository and return { planId, status }
 *    IMMEDIATELY to the caller — the LLM call is fire-and-forget.
 * 4. Background task (unhandled rejection is caught → markFailed):
 *    resolveExerciseVocabulary → generator.generate → normalizeProgramReps
 *    → injectLimitationWarnings → assertNoDiagnosticLanguage
 *    → resolveProgramCatalogIds → markReady.
 *    On ANY error → markFailed.
 *
 * Stuck-generating strategy: MANUAL REGENERATE ONLY.
 * Stale "generating" rows (e.g. from a server restart mid-generation) are NOT
 * auto-swept. They remain visible for audit. The user must explicitly trigger
 * regenerate (POST /plan-specs/:id/regenerate), which creates a fresh
 * "generating" row. The stale row is retained — only the latest row is shown
 * in the UI via findLatestByPlanSpec ordering by createdAt DESC.
 */
export class PlanGenerationService {
  constructor(
    private generator: PlanGenerator,
    private specRepo: Pick<PlanSpecRepository, "findConfirmedById">,
    private planRepo: Pick<
      WorkoutPlanRepository,
      "createGenerating" | "markReady" | "markFailed"
    >,
    /** Optional WsRegistry. When provided, notifies the user after markReady/markFailed. */
    private wsRegistry?: WsRegistry,
    private memoryRetriever?: {
      retrieve(
        scope: { tenantId: string; userId: string },
        options: { query: string; limit?: number },
      ): Promise<VectorMemoryRecord[]>;
    },
    /**
     * Optional 11a billing gate for premium memory retrieval. When present and
     * the entitlement is denied, retrieval is SKIPPED before any embedding or
     * vector search — a denial is never used as a technical fail-open fallback.
     */
    private memoryEntitlement?: MemoryRetrievalEntitlementPort,
    /**
     * Optional observability seam (#310). Records `generation.started` /
     * `.ready` / `.failed` alongside the existing console.* lines, carrying ONLY
     * ids (planId, planSpecId) and — on failure — the error NAME (never the
     * message, spec, or program content). Fire-and-forget; never blocks the
     * pipeline. The console.* lines are retained unchanged so existing tests and
     * log aggregators keep working.
     */
    private observability?: ObservabilityLogger,
    /**
     * Optional profile/weight sources (17c-profile-body-metrics, PR 3). When
     * both are absent (e.g. existing tests that construct the service bare),
     * `attachBodyProfile` is a no-op and the generated prompt is
     * byte-identical to before this change.
     */
    private userProfileSource?: UserProfilePort,
    private weightEntrySource?: WeightEntryPort
  ) {}

  /**
   * Start generation for a confirmed plan spec.
   *
   * Returns { planId, status: "generating" } immediately.
   * The LLM pipeline runs in the background — caller must not await it.
   *
   * @param tenantId  Tenant from authContext (never from request body)
   * @param userId    User from authContext (never from request body)
   * @param planSpecId ID of the confirmed plan spec to generate from
   * @param locale    App locale for the DETERMINISTIC limitation warnings (#260).
   *                  Defaults to `"en"` so existing callers/tests are unaffected.
   *
   * @throws PlanSpecNotFoundError (404) when the spec is missing or unconfirmed
   * @throws PlanSpecShapeError (422) when the spec fails assertPlanSpecShape
   */
  async startGeneration(
    tenantId: string,
    userId: string,
    planSpecId: string,
    locale: WarningLocale = "en"
  ): Promise<{ planId: string; status: "generating" }> {
    const spec = await this.loadValidatedSpec(tenantId, userId, planSpecId);

    // Step 3: Create the "generating" row and return planId immediately.
    // #93: thread the user-supplied plan name carried on the confirmed spec into
    // the row. A blank submission is already normalized to null on promote, so we
    // pass `spec.name ?? null` verbatim — the blank→default rule is applied only
    // on read via defaultPlanName, never here.
    const { id: planId } = await this.planRepo.createGenerating(
      tenantId,
      userId,
      planSpecId,
      spec.name ?? null
    );

    // #310: curated started event (ids only) alongside the console.info below.
    this.observability?.recordEvent({
      tenantId,
      level: "info",
      event: "generation.started",
      metadata: { planId, planSpecId },
    });

    // Step 4: Fire-and-forget background task.
    // Promise rejection is caught inside the task — no unhandledRejection.
    void this.runGenerationTask(tenantId, userId, planId, planSpecId, spec, locale);

    return { planId, status: "generating" };
  }

  /**
   * Validate a plan spec is generatable WITHOUT starting generation.
   *
   * 11a billing: callers (the route) MUST call this BEFORE consuming any
   * quota, so a 404/422 on a nonexistent/unconfirmed/invalid spec never
   * spends a unit — only a successful generation start should consume.
   *
   * @throws PlanSpecNotFoundError (404) when the spec is missing or unconfirmed
   * @throws PlanSpecShapeError (422) when the spec fails assertPlanSpecShape
   */
  async assertGeneratable(tenantId: string, userId: string, planSpecId: string): Promise<void> {
    await this.loadValidatedSpec(tenantId, userId, planSpecId);
  }

  /** Shared load + shape-validate step used by both startGeneration and assertGeneratable. */
  private async loadValidatedSpec(
    tenantId: string,
    userId: string,
    planSpecId: string
  ): Promise<import("@kinora/contracts").PlanSpec> {
    // Step 1: Load confirmed spec — throws 404 if missing or unconfirmed
    const specRow = await this.specRepo.findConfirmedById(tenantId, userId, planSpecId);
    if (!specRow) {
      throw new PlanSpecNotFoundError(planSpecId);
    }

    // Step 2: Validate spec shape — throws 422 if structurally invalid
    try {
      assertPlanSpecShape(specRow.specJson);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PlanSpecShapeError(message);
    }
    return specRow.specJson;
  }

  /**
   * Background generation pipeline. All errors are caught and routed to markFailed.
   * This method never rejects — unhandledRejection is impossible.
   *
   * Notifies the user via WsRegistry after markReady / markFailed.
   * Payload is ONLY { planId, status } — NO program content, NO health data.
   * notify failure is swallowed (fire-and-forget-safe).
   *
   * Logs ONLY: planId, tenantId, planSpecId, error.name, error.message, error.stack.
   * NEVER logs: spec content, limitations, program content, or any health/plan
   * data. This is a hard privacy invariant.
   *
   * ONE deliberate exception, added by #352 slice B: the `generation.
   * exercise_unresolved` event carries the prescribed exercise NAME. An exercise
   * name is a movement label chosen by the model from a public catalog's
   * vocabulary — it is not user-authored text and reveals nothing about the
   * person, unlike a limitation ("bad knee") or a memory. Without it the event
   * is a bare counter that cannot be acted on. Nothing else about the program
   * (sets, reps, notes, session titles) is recorded.
   */
  private async runGenerationTask(
    tenantId: string,
    userId: string,
    planId: string,
    planSpecId: string,
    spec: import("@kinora/contracts").PlanSpec,
    locale: WarningLocale
  ): Promise<void> {
    // Signal: task is starting (greppable prefix for log aggregators)
    console.info("[generation-service] generation started", { planId, tenantId });

    try {
      const withMemory = await this.attachMemoryContext(tenantId, userId, planId, spec);
      // Skips the call (not just its work) when neither source is injected —
      // `attachBodyProfile` is declared `async`, so even its early-return
      // branch would otherwise add a microtask hop that does not exist
      // today, changing the pipeline's timing for every existing caller
      // that never injects these optional sources (i.e. every test but the
      // one covering this feature).
      const withBodyProfile =
        this.userProfileSource || this.weightEntrySource
          ? await this.attachBodyProfile(userId, withMemory)
          : withMemory;
      // #352 slice B: the vocabulary is derived once and used twice — as the
      // closed list in the prompt, and as the allow-list the generated names are
      // resolved against afterwards. Deriving it in one place is what makes
      // "what we asked for" and "what we accept" provably the same set.
      const vocabulary = this.buildVocabulary(tenantId, planId, planSpecId, spec);
      const generationInput = {
        ...withBodyProfile,
        allowedExercises: vocabulary.promptNames,
      };
      // generate → post-process → guard → persist
      const rawProgram = await this.generator.generate(generationInput);
      const normalized = normalizeProgramReps(rawProgram);
      // #260: limitation warnings are DETERMINISTIC and LOCALIZED — they are the
      // SINGLE source of truth. Drop any warnings the LLM may have authored
      // (its English prompt can leak English prose even when the app is in
      // Spanish) before injecting the locale-correct deterministic ones, so no
      // mixed-language text ever reaches the persisted program.
      const withoutLlmWarnings = { ...normalized, limitationWarnings: [] };
      const withWarnings = injectLimitationWarnings(
        withoutLlmWarnings,
        spec.limitations,
        locale
      );
      assertNoDiagnosticLanguage(withWarnings);

      // #352 slice B: link to the catalog LAST, so the id is attached to the
      // exact program that gets persisted and no later transform can drop it.
      // A miss never fails the plan — see catalog-resolution.ts.
      const linked = this.linkToCatalog(
        tenantId,
        planId,
        planSpecId,
        withWarnings,
        vocabulary.allowedIds
      );

      const result = await this.planRepo.markReady(tenantId, planId, linked);
      if (!result) {
        // markReady updated 0 rows (tenant mismatch or race — should not happen
        // normally, but log so stuck-generating is traceable).
        console.warn(
          `[generation-service] markReady returned undefined for planId=${planId} tenantId=${tenantId} — plan may be stuck in generating`
        );
        // #310: this edge case (tenant mismatch or race) must still leave an
        // observability trail — it neither reaches the success recordEvent
        // below nor the catch's generation.failed, so without this it would
        // silently record nothing. ids only (planId/planSpecId) — no spec or
        // program content.
        this.observability?.recordEvent({
          tenantId,
          level: "warn",
          event: "generation.ready",
          outcome: "stale_no_rows",
          metadata: { planId, planSpecId },
        });
        // Do NOT notify "ready" — the DB was not updated, so the plan is still
        // in "generating" state. Emitting a false-ready would contradict the DB.
        // The client stays in "generating" until the user triggers regenerate.
        return;
      }

      // Signal: generation pipeline completed successfully.
      // Log ONLY ids — never log the program or any health/plan content.
      console.info("[generation-service] generation ready", { planId, tenantId });
      this.observability?.recordEvent({
        tenantId,
        level: "info",
        event: "generation.ready",
        metadata: { planId, planSpecId },
      });

      // Notify the user via WebSocket — fire-and-forget-safe.
      // Payload: ONLY { planId, status } — no program content, no health data.
      try {
        this.wsRegistry?.notify(userId, { planId, status: "ready" });
      } catch {
        // Swallow notify failures — a broken WS must not abort the generation pipeline.
      }
    } catch (error) {
      // Log the failure BEFORE attempting markFailed so it is always visible even
      // if markFailed itself throws. Log ONLY ids + error metadata — NEVER log
      // spec content, limitations, program content, or any health/plan data.
      const name = error instanceof Error ? error.name : "UnknownError";
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error("[generation-service] generation failed", { planId, tenantId, name, message, stack });
      // #310: record the failure carrying ONLY ids + the error NAME — never the
      // message, stack, spec, or program content (hard privacy invariant).
      this.observability?.recordEvent({
        tenantId,
        level: "error",
        event: "generation.failed",
        metadata: { planId, planSpecId, errorName: name },
      });

      // markFailed errors are swallowed — the plan row is already persisted as "generating"
      // and the user can still trigger regenerate via POST /plan-specs/:id/regenerate.
      try {
        const result = await this.planRepo.markFailed(tenantId, planId, message);
        // Fix 8: warn if markFailed updated 0 rows — same stuck-generating concern.
        if (!result) {
          console.warn(
            `[generation-service] markFailed returned undefined for planId=${planId} tenantId=${tenantId} — plan may be stuck in generating`
          );
        }
      } catch {
        // Intentionally swallowed — do not let markFailed failure propagate
      }

      // Notify the user of failure — fire-and-forget-safe.
      try {
        this.wsRegistry?.notify(userId, { planId, status: "failed" });
      } catch {
        // Swallow notify failures — a broken WS must not abort error recovery.
      }
    }
  }

  /**
   * Derives the user's exercise vocabulary and the capped subset the prompt can
   * afford, recording BOTH reductions rather than letting either happen quietly.
   *
   * The two are reported separately because they mean different things:
   * `ignoredEquipment` is a wizard answer that bought the user nothing (worth
   * fixing in the mapping table), while `droppedCount` is our own prompt budget
   * (worth watching, but by design).
   */
  private buildVocabulary(
    tenantId: string,
    planId: string,
    planSpecId: string,
    spec: import("@kinora/contracts").PlanSpec
  ): { promptNames: string[]; allowedIds: ReadonlySet<string> } {
    const { exercises, ignoredEquipment } = resolveExerciseVocabulary(spec.equipment);
    const capped = capVocabularyForPrompt(exercises);

    // Scalars and ids only. Counts, not the vocabulary itself — the list is
    // large and derivable from the spec, so logging it would be volume without
    // information. `ignoredEquipment` is a wizard enum, never user prose.
    this.observability?.recordEvent({
      tenantId,
      level: capped.droppedCount > 0 || ignoredEquipment.length > 0 ? "warn" : "info",
      event: "generation.vocabulary",
      metadata: {
        planId,
        planSpecId,
        vocabularySize: exercises.length,
        promptSize: capped.exercises.length,
        droppedCount: capped.droppedCount,
        ignoredEquipment: ignoredEquipment.join(",") || null,
      },
    });

    return {
      promptNames: capped.exercises.map((record) => record.name),
      allowedIds: new Set(exercises.map((record) => record.id)),
    };
  }

  /**
   * Attaches catalog ids to a finished program and reports every exercise the
   * catalog could not account for.
   *
   * One event per miss, carrying the exercise NAME: unlike a limitation or a
   * memory, a prescribed exercise name is not user content, and the name is the
   * only thing that makes the miss actionable — a count alone cannot tell us
   * whether the model is inventing movements or merely spelling them our way.
   */
  private linkToCatalog(
    tenantId: string,
    planId: string,
    planSpecId: string,
    program: import("@kinora/contracts").WorkoutProgram,
    allowedIds: ReadonlySet<string>
  ): import("@kinora/contracts").WorkoutProgram {
    const { program: linked, resolvedCount, unresolved } = resolveProgramCatalogIds(
      program,
      allowedIds
    );

    for (const miss of unresolved) {
      this.observability?.recordEvent({
        tenantId,
        level: "warn",
        event: "generation.exercise_unresolved",
        outcome: miss.reason,
        metadata: {
          planId,
          planSpecId,
          exerciseName: miss.name,
          day: miss.day,
          exerciseIndex: miss.index,
        },
      });
    }

    this.observability?.recordEvent({
      tenantId,
      level: "info",
      event: "generation.catalog_resolution",
      metadata: {
        planId,
        planSpecId,
        resolvedCount,
        unresolvedCount: unresolved.length,
      },
    });

    return linked;
  }

  /**
   * Attaches `bodyProfile` beside `allowedExercises` (17c-profile-body-
   * metrics, PR 3): the profile's `selfDescribedSex`/`heightCm` and the
   * user's MOST RECENT bodyweight reading, mapped into
   * `BodyProfilePromptInput`. This is a snapshot for GENERATION, not the
   * per-session resolution `resolveBodyweightForSession` performs for
   * volume (a different concern, added by PR 4) — plan generation happens
   * once, not against a specific past session, so "current weight" is
   * simply the newest entry.
   *
   * `prefer_not_to_say` is dropped here, not merely by the type: a
   * declined answer must never reach the prompt, and `Exclude<SelfDescribedSex,
   * "prefer_not_to_say">` on `BodyProfilePromptInput` only stops it from
   * being ASSIGNED — a runtime value read from the database still needs an
   * explicit runtime check.
   *
   * Returns `spec` unchanged when neither source is injected, or when
   * neither yields anything to attach — `buildPlanPrompt` then renders
   * byte-identically to before this change.
   */
  private async attachBodyProfile<T extends import("@kinora/contracts").PlanSpec>(
    userId: string,
    spec: T
  ): Promise<T & { bodyProfile?: BodyProfilePromptInput }> {
    if (!this.userProfileSource && !this.weightEntrySource) {
      return spec;
    }

    const [profile, entries] = await Promise.all([
      this.userProfileSource?.findByUserId(userId) ?? Promise.resolve(null),
      this.weightEntrySource?.list(userId) ?? Promise.resolve([]),
    ]);

    const bodyProfile: BodyProfilePromptInput = {};
    if (profile?.selfDescribedSex && profile.selfDescribedSex !== "prefer_not_to_say") {
      bodyProfile.selfDescribedSex = profile.selfDescribedSex;
    }
    if (profile?.heightCm != null) {
      bodyProfile.heightCm = profile.heightCm;
    }
    if (entries.length > 0) {
      // `list()` is newest-first — the first entry IS the most recent reading.
      bodyProfile.bodyweightKg = entries[0]!.weightKg;
    }

    return Object.keys(bodyProfile).length > 0 ? { ...spec, bodyProfile } : spec;
  }

  private async attachMemoryContext(
    tenantId: string,
    userId: string,
    planId: string,
    spec: import("@kinora/contracts").PlanSpec
  ): Promise<import("@kinora/contracts").PlanSpec & { memoryContext?: string[] }> {
    if (!this.memoryRetriever) {
      return spec;
    }

    // 11a billing: premium retrieval entitlement is a PRODUCT gate. A denial
    // skips retrieval outright (no embedding, no vector search) and must not be
    // treated as a technical failure that could fall through to a fallback.
    // A THROWN/technical failure of the gate itself (e.g. a transient billing
    // read error) must ALSO fail open — an optional premium enhancement's gate
    // outage must never abort the user's core plan generation (mirrors the
    // fail-open posture already applied to retrieve() below).
    if (this.memoryEntitlement) {
      let allowed: boolean;
      try {
        allowed = (await this.memoryEntitlement.check({ tenantId, userId })).allowed;
      } catch (error) {
        console.warn("[generation-service] memory entitlement check failed", {
          planId,
          tenantId,
          errorName: error instanceof Error ? error.name : "unknown",
        });
        return spec;
      }
      if (!allowed) {
        console.info("[generation-service] vector memory retrieval skipped (entitlement denied)", {
          planId,
          tenantId,
        });
        return spec;
      }
    }

    try {
      const memories = await this.memoryRetriever.retrieve(
        { tenantId, userId },
        {
          query: buildMemoryRetrievalQuery(spec),
          limit: 3,
        }
      );

      if (memories.length === 0) {
        return spec;
      }

      console.info("[generation-service] vector memory retrieved", {
        planId,
        tenantId,
        count: memories.length,
      });

      return {
        ...spec,
        memoryContext: memories.map((memory) => memory.summary),
      };
    } catch (error) {
      console.warn("[generation-service] vector memory retrieval failed", {
        planId,
        tenantId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return spec;
    }
  }
}

function buildMemoryRetrievalQuery(spec: import("@kinora/contracts").PlanSpec): string {
  const limitationText = spec.limitations.map((item) => item.text);
  return mask([spec.goal, spec.location, ...spec.equipment, ...limitationText]
    .filter((value) => value.trim() !== "")
    .join(" "), limitationText);
}
