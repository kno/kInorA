/**
 * Flushable wrapper around an {@link ObservabilityEventRecorderPort} (#310).
 *
 * WHY THIS EXISTS: `DefaultObservabilityLogger.recordEvent` dispatches the
 * persistence write WITHOUT awaiting it — the right trade-off on a request
 * path, where an observability INSERT must never block or break a domain flow.
 * A short-lived process (the cron seat-sync sweep, `scripts/reconcile-seats.mjs`)
 * has the opposite problem: it closes its pool and calls `process.exit` moments
 * after recording its last event, so a fire-and-forget INSERT can be lost
 * before it reaches Postgres. Losing the "sweep FAILED" event is exactly the
 * failure this instrumentation exists to surface.
 *
 * This wrapper tracks every in-flight write so a batch process can `await
 * flush()` before exiting, WITHOUT changing the logger's contract: `record`
 * still returns the underlying promise (rejection included) so the logger keeps
 * swallowing failures and downgrading them to a sink warning.
 */
import type {
  ObservabilityEventRecord,
  ObservabilityEventRecorderPort,
} from "./event-logger.js";

/** A recorder whose dispatched writes can be awaited before process exit. */
export interface FlushableEventRecorder extends ObservabilityEventRecorderPort {
  /**
   * Resolve once every write dispatched so far has settled. NEVER rejects — a
   * failed write is already reported through the logger's sink, and flushing
   * must not become a new failure mode for the caller.
   */
  flush(): Promise<void>;
}

/**
 * Wrap `inner` so its dispatched writes are awaitable via {@link
 * FlushableEventRecorder.flush}. Writes started *during* a flush are awaited
 * too (the loop re-checks), so a flush cannot return while an event recorded
 * from a sink callback is still in flight.
 */
export function createFlushableRecorder(
  inner: ObservabilityEventRecorderPort,
): FlushableEventRecorder {
  const pending = new Set<Promise<void>>();

  return {
    record(event: ObservabilityEventRecord): Promise<void> {
      // Normalize a synchronous throw from `inner.record` into a rejected
      // promise so both failure shapes are tracked identically.
      const write = (async () => inner.record(event))();

      // Tracked separately and deliberately non-rejecting: `flush` must not
      // surface a write failure, and an untracked rejection must not escape.
      const tracked = write.then(
        () => undefined,
        () => undefined,
      );
      pending.add(tracked);
      void tracked.then(() => {
        pending.delete(tracked);
      });

      return write;
    },

    async flush(): Promise<void> {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}
