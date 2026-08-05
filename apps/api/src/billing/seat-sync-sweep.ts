/**
 * Observable seat-billing reconcile sweep (16c-v3-b2b-seat-billing follow-up,
 * issue #330 step 5).
 *
 * `scripts/reconcile-seats.mjs` used to `console.log` and nothing else: a sweep
 * never appeared in the superadmin /admin/logs view (#310) and a failing
 * nightly run surfaced nowhere unless someone happened to read the cron output.
 * This module is the sweep's one instrumented use case, extracted OUT of the
 * `.mjs` entrypoint so the logging paths (success AND failure) are unit-testable
 * TypeScript instead of untestable script glue — the entrypoint keeps only the
 * composition of the compiled `dist/**` build (see that file's header).
 *
 * Records exactly three PII-free events (`billing.seat_sync_sweep`, system
 * level — no tenantId, no actorUserId): `started`, `completed` with the
 * reconciled sponsor count, and `failed` with the error name/message. Both
 * terminal events also carry `seatBillingEnabled` — read off the composed
 * service, not from env — because with the flag off the sweep recomputes
 * DB-side and pushes NOTHING to Stripe, and a bare count cannot tell those two
 * outcomes apart a month later. Sponsor
 * tenant ids are returned to the caller but deliberately NOT written into
 * metadata: the count answers "did the sweep heal anything", and /admin/logs is
 * a cross-tenant view where a per-tenant list adds no operational signal.
 */
import type { Database } from "../db/client.js";
import { ObservabilityEventsRepository } from "../db/repositories/observability-events.js";
import {
  DefaultObservabilityLogger,
  type ObservabilityLogger,
  type StructuredLogSink,
} from "../observability/event-logger.js";
import { createConsoleLogSink } from "../observability/console-sink.js";
import { createFlushableRecorder } from "../observability/flushable-recorder.js";

/** Event name every sweep observation is recorded under. */
export const SEAT_SYNC_SWEEP_EVENT = "billing.seat_sync_sweep";

/**
 * The one `SeatSyncService` capability the sweep needs — structurally satisfied
 * by the real service, so a test can drive the sweep with a fake instead of a
 * Postgres advisory lock and a Stripe gateway.
 */
export interface SeatSyncSweepReconciler {
  reconcileAllStaleSponsors(): Promise<string[]>;
  /**
   * Read off the SERVICE, never re-read from `SEAT_BILLING_ENABLED` here — a
   * second env read could report a mutation that the service skipped (or vice
   * versa). See `SeatSyncService.outboundMutationEnabled`.
   */
  readonly outboundMutationEnabled: boolean;
}

/** Dependencies for {@link runSeatSyncSweep}. */
export interface SeatSyncSweepDeps {
  seatSync: SeatSyncSweepReconciler;
  observability: ObservabilityLogger;
  /**
   * Awaited after the terminal event is recorded, so a short-lived process
   * cannot exit before the INSERT lands (see `flushable-recorder.ts`). Optional
   * — a caller with a long-lived logger has nothing to flush.
   */
  flush?: () => Promise<void>;
}

/**
 * Run the reconcile sweep, recording it as observability events.
 *
 * Returns the reconciled sponsor tenant ids. RETHROWS on failure (after
 * recording the `failed` event and flushing it) so the caller — the cron
 * entrypoint — still exits non-zero and the scheduled job goes red.
 */
export async function runSeatSyncSweep(deps: SeatSyncSweepDeps): Promise<string[]> {
  const { seatSync, observability, flush } = deps;

  observability.recordEvent({
    level: "info",
    event: SEAT_SYNC_SWEEP_EVENT,
    outcome: "started",
  });

  try {
    const reconciled = await seatSync.reconcileAllStaleSponsors();

    observability.recordEvent({
      level: "info",
      event: SEAT_SYNC_SWEEP_EVENT,
      outcome: "completed",
      metadata: {
        reconciledCount: reconciled.length,
        // Without this the count is unreadable: with the flag OFF the sweep
        // recomputes DB-side and pushes NOTHING to Stripe, so
        // `reconciledCount: 61, seatBillingEnabled: false` means "61
        // recomputed, zero subscriptions actually corrected".
        seatBillingEnabled: seatSync.outboundMutationEnabled,
      },
    });

    await flush?.();
    return reconciled;
  } catch (error) {
    observability.recordEvent({
      level: "error",
      event: SEAT_SYNC_SWEEP_EVENT,
      outcome: "failed",
      metadata: {
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
        // Recorded here too: whether a partial sweep could have already pushed
        // a quantity to Stripe before it broke is the first thing an operator
        // triaging a red run needs to know.
        seatBillingEnabled: seatSync.outboundMutationEnabled,
      },
    });

    // Flush BEFORE rethrowing: the caller exits the process on this path, and
    // the failure event is the whole point of the instrumentation.
    await flush?.();
    throw error;
  }
}

/** An observability logger plus the flush hook {@link runSeatSyncSweep} needs. */
export interface SeatSyncSweepObservability {
  observability: ObservabilityLogger;
  flush: () => Promise<void>;
}

/**
 * Compose the sweep's observability logger: the same DB-backed
 * `DefaultObservabilityLogger` + `ObservabilityEventsRepository` pair `app.ts`
 * builds (so a sweep event is indistinguishable from a server event in
 * /admin/logs), wrapped so its fire-and-forget writes are flushable, and sunk
 * to `console` since a script has no Fastify `app.log`.
 */
export function buildSeatSyncSweepObservability(
  database: Database,
  sink: StructuredLogSink = createConsoleLogSink(),
): SeatSyncSweepObservability {
  const recorder = createFlushableRecorder(new ObservabilityEventsRepository(database));
  return {
    observability: new DefaultObservabilityLogger(recorder, sink),
    flush: () => recorder.flush(),
  };
}
