/**
 * Console-backed {@link StructuredLogSink} for processes that have no Fastify
 * instance (#310 + the cron seat-sync sweep).
 *
 * The running server passes `app.log` (pino) as the logger's sink. A standalone
 * ops script has no `app`, so without this it would persist events to
 * `observability_events` while printing nothing to stdout — breaking the hybrid
 * invariant in `event-logger.ts` (persistence NEVER replaces logs) exactly
 * where stdout is the only thing a `docker logs` / cron mail can show.
 *
 * Emits one JSON line per event, so a cron log stays greppable.
 */
import type { StructuredLogSink } from "./event-logger.js";

/**
 * Build a sink that writes single-line JSON to `console`. `info`/`warn` go to
 * stdout and `error` to stderr, so a non-zero-exit sweep surfaces on the
 * stream a cron wrapper is most likely to capture.
 */
export function createConsoleLogSink(): StructuredLogSink {
  const line = (obj: object, msg?: string): string =>
    JSON.stringify(msg === undefined ? obj : { msg, ...obj });

  return {
    info(obj, msg) {
      console.log(line(obj, msg));
    },
    warn(obj, msg) {
      console.warn(line(obj, msg));
    },
    error(obj, msg) {
      console.error(line(obj, msg));
    },
  };
}
