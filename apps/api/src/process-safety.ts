/**
 * Process-level safety net (resilience).
 *
 * A background async rejection from a third-party SDK — e.g. a malformed
 * provider SSE chunk surfacing as `GoogleGenerativeAIError: Failed to parse
 * stream` via a ReadableStream `controller.error()` in a microtask with no
 * consumer awaiting it — is an UNHANDLED REJECTION. Node's default handling
 * TERMINATES the whole process, so one user's transient provider glitch takes
 * down the API for every in-flight request. The per-request path already fails
 * that turn closed (the chat SSE route emits a terminal `error` event), so the
 * server itself MUST NOT die for it.
 *
 * This installs an `unhandledRejection` handler that LOGS the reason and keeps
 * the process alive. Scope is deliberately narrow: only `unhandledRejection`
 * is swallowed. A synchronous `uncaughtException` (a genuinely fatal,
 * likely state-corrupting fault) is left to Node's default so we never mask a
 * real bug or run in a corrupt state.
 */

/** Minimal logger surface (Fastify's `app.log` satisfies it). */
export interface SafetyNetLogger {
  error(obj: unknown, msg?: string): void;
}

/**
 * Register the `unhandledRejection` safety net. Returns an unregister function
 * (used by tests to avoid leaking listeners across cases).
 */
export function registerProcessSafetyNet(log: SafetyNetLogger): () => void {
  const onUnhandledRejection = (reason: unknown): void => {
    log.error(
      { err: reason instanceof Error ? reason : new Error(String(reason)) },
      "Unhandled promise rejection — API process kept alive (see resilience net)",
    );
  };
  process.on("unhandledRejection", onUnhandledRejection);
  return () => {
    process.off("unhandledRejection", onUnhandledRejection);
  };
}
