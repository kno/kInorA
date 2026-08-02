/**
 * Structured observability logging (#310, Slice 1) — the core abstraction.
 *
 * `ObservabilityLogger.recordEvent` is the ONE seam every instrumented call
 * site uses to emit a curated domain event. The default implementation fans
 * out to BOTH:
 *   (a) a persistence recorder (INSERT into `observability_events`), giving the
 *       superadmin /admin/logs view durable, filterable history; AND
 *   (b) a pino-style structured sink, so stdout / `docker logs` still shows the
 *       exact same event (the hybrid design — persistence NEVER replaces logs).
 *
 * FIRE-AND-FORGET + FAIL-SAFE (hard requirement): recording an event must NEVER
 * throw into, or block, the request path. `recordEvent` returns `void`
 * synchronously; the persistence write is dispatched WITHOUT `await`, and any
 * error (sync throw or rejected promise) is swallowed and downgraded to a sink
 * `warn`. A failed observability write can therefore never break billing,
 * generation, provisioning, or any other domain flow.
 *
 * HARD PRIVACY INVARIANT (AGENTS.md:72, mirrors generation-service.ts:174-176):
 * `metadata` is typed as a flat record of SCALARS/IDS only. Callers MUST pass
 * ONLY non-sensitive identifiers (tenantId, actorUserId, planId, planSpecId,
 * overrideId, eventId…), enums/outcomes, an error name/message (never arbitrary
 * user content), and non-sensitive scalars (tier, limit, feature, status,
 * route, statusCode). NEVER pass secrets, tokens, credentials, health data,
 * plan/exercise/program content, prompts, or any PII. The scalar-only type
 * makes the safe path the path of least resistance — you cannot hand it a
 * nested object, array, or buffer of user content.
 */

export type ObservabilityLevel = "info" | "warn" | "error";

/** A single metadata value: a scalar id/enum/flag — never nested user content. */
export type ObservabilityMetadataValue = string | number | boolean | null | undefined;

/** Flat, scalar-only metadata bag. See the PII invariant above. */
export type ObservabilityMetadata = Record<string, ObservabilityMetadataValue>;

/** Consumer-facing input for {@link ObservabilityLogger.recordEvent}. */
export interface ObservabilityEventInput {
  /** Owning tenant id, or omit/null for a system-level event. */
  tenantId?: string | null;
  /** Acting user id, or omit/null for a system/anonymous event. */
  actorUserId?: string | null;
  level: ObservabilityLevel;
  /** Open-set event name, e.g. "billing.webhook", "generation.ready". */
  event: string;
  /** Optional outcome/result enum, e.g. "processed", "duplicate", "denied". */
  outcome?: string | null;
  /** Scalar-only, PII-free metadata (see the invariant above). */
  metadata?: ObservabilityMetadata;
}

/**
 * The normalized row handed to the persistence recorder. `undefined` optionals
 * are resolved to `null`/`{}`; `undefined` metadata values are stripped.
 */
export interface ObservabilityEventRecord {
  tenantId: string | null;
  actorUserId: string | null;
  level: ObservabilityLevel;
  event: string;
  outcome: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

/**
 * Persistence port the default logger fans out to. Implemented by the infra
 * `ObservabilityEventsRepository` (db/repositories/observability-events.ts).
 * `record` MAY reject; the logger guarantees the rejection is swallowed.
 */
export interface ObservabilityEventRecorderPort {
  record(event: ObservabilityEventRecord): Promise<void>;
}

/**
 * Minimal pino-compatible structured sink. Fastify's `app.log` satisfies this
 * (and its no-op logger under tests satisfies it too). Kept as a narrow port so
 * the logger never imports Fastify/pino directly.
 */
export interface StructuredLogSink {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** The observability seam every instrumented domain call site depends on. */
export interface ObservabilityLogger {
  /**
   * Record a curated domain event. Returns immediately — the persistence write
   * is fire-and-forget and any failure is swallowed (never rethrown).
   */
  recordEvent(input: ObservabilityEventInput): void;
}

/**
 * Strip `undefined` values so an omitted-but-present metadata key never lands
 * as a literal `null` when the caller meant "absent". `null` is preserved (an
 * intentional "known-absent" scalar).
 */
function sanitizeMetadata(
  metadata: ObservabilityMetadata | undefined,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!metadata) return out;
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Default {@link ObservabilityLogger}: emits a structured sink line AND
 * dispatches a fire-and-forget persistence write, swallowing every error.
 */
export class DefaultObservabilityLogger implements ObservabilityLogger {
  constructor(
    private readonly recorder: ObservabilityEventRecorderPort,
    private readonly sink?: StructuredLogSink,
  ) {}

  recordEvent(input: ObservabilityEventInput): void {
    const row: ObservabilityEventRecord = {
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId ?? null,
      level: input.level,
      event: input.event,
      outcome: input.outcome ?? null,
      metadata: sanitizeMetadata(input.metadata),
    };

    // (a) Structured sink line — must never throw into the caller.
    try {
      this.sink?.[input.level](
        {
          event: row.event,
          tenantId: row.tenantId,
          actorUserId: row.actorUserId,
          outcome: row.outcome,
          ...row.metadata,
        },
        "observability.event",
      );
    } catch {
      // A broken logger must never break the request path.
    }

    // (b) Fire-and-forget persistence write. Guard BOTH a synchronous throw
    // (e.g. a mock db) and a rejected promise so nothing ever escapes.
    try {
      const pending = this.recorder.record(row);
      if (pending && typeof pending.then === "function") {
        pending.catch((error: unknown) => this.onRecordError(error));
      }
    } catch (error) {
      this.onRecordError(error);
    }
  }

  private onRecordError(error: unknown): void {
    try {
      this.sink?.warn(
        {
          event: "observability.record_failed",
          errorName: error instanceof Error ? error.name : "unknown",
        },
        "observability persistence write failed (swallowed)",
      );
    } catch {
      // Even the failure-report must never throw.
    }
  }
}
