import { CallbackHandler } from "langfuse-langchain";
import type { ResolvePrompt } from "./prompt-provider.js";
import { redactTracedPayload } from "./trace-redaction.js";

/**
 * Structural port over the Langfuse `CallbackHandler`, so no test ever needs
 * the real class. Any object shaped like this (including a fake in tests)
 * satisfies it.
 */
export interface TracingHandler {
  readonly name: string;
  flushAsync(): Promise<unknown>;
}

/**
 * Shared injection bag threaded into both tracing attachment sites
 * (`invokeChain` in `adapter-factory.ts` and `PlanSpecExtractionAdapter`'s
 * `streamReply`/`extract`). `handler` shipped in slice A1; `prompts` (slice
 * B2) resolves each call's prompt through Langfuse with a mandatory local
 * fallback, attributing `promptSource` on the trace metadata.
 */
export interface AiTracingDeps {
  handler?: TracingHandler | null;
  prompts?: ResolvePrompt;
}

/**
 * Resolve the Langfuse base URL with precedence `LANGFUSE_BASEURL ??
 * LANGFUSE_HOST`. The JS SDK reads `LANGFUSE_BASEURL` implicitly, but
 * production only forwards `LANGFUSE_HOST` (`docker-compose.yml`) — relying
 * on implicit SDK pickup would silently ignore the configured production
 * host. Returns `undefined` when neither is set, so the SDK falls back to
 * its own default rather than receiving an explicit empty value.
 */
export function resolveLangfuseBaseUrl(
  env: Record<string, string | undefined>
): string | undefined {
  return env["LANGFUSE_BASEURL"] ?? env["LANGFUSE_HOST"];
}

/**
 * Build a Langfuse `CallbackHandler`, or `null` when either credential is
 * absent or construction fails.
 *
 * Safe by construction: this function NEVER throws. A construction failure
 * (invalid credentials, transport misconfiguration) is caught and reported
 * through the injected `warn` sink with a reason code and the error's
 * `name` only — never a credential, never a template/prompt body.
 *
 * @param opts.env  Env bag to read credentials/base URL from (default `process.env`).
 * @param opts.warn Secret-free warn sink, called at most once per construction
 *   attempt (default `console.warn`).
 */
export function buildLangfuseCallbackHandler(opts?: {
  env?: Record<string, string | undefined>;
  warn?: (errorName: string) => void;
}): TracingHandler | null {
  const env = opts?.env ?? process.env;
  const warn = opts?.warn ?? ((message: string) => console.warn(message));

  const publicKey = env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = env["LANGFUSE_SECRET_KEY"];
  if (!publicKey || !secretKey) {
    return null;
  }

  const baseUrl = resolveLangfuseBaseUrl(env);

  try {
    return new CallbackHandler({
      publicKey,
      secretKey,
      // 17c-profile-body-metrics, PR 3: the ONLY seam where the model input
      // and the trace input can diverge — see trace-redaction.ts. Applied by
      // the SDK to `input`/`output` at enqueue, in-process, before any
      // network call; a throw inside it fails CLOSED (the whole payload is
      // replaced), so a bug here cannot become a leak.
      mask: redactTracedPayload,
      ...(baseUrl ? { baseUrl } : {}),
    }) as TracingHandler;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    warn(`[langfuse-handler] construction failed: ${errorName}`);
    return null;
  }
}

/**
 * Best-effort flush of a Langfuse handler on app shutdown: never throws,
 * never blocks Fastify's close sequence. A flush failure is not surfaced
 * anywhere beyond a warn line — losing the last few buffered traces on
 * shutdown is an acceptable cost. No-ops when `handler` is `null`.
 *
 * @param handler Nullable tracing handler to flush.
 * @param warn    Secret-free warn sink, called at most once, with the same
 *   `(payload, message)` shape Fastify's/pino's `logger.warn` uses.
 */
export async function flushLangfuseHandlerOnClose(
  handler: TracingHandler | null,
  warn: (payload: { errName: string }, message: string) => void
): Promise<void> {
  if (!handler) return;
  try {
    await handler.flushAsync();
  } catch (error) {
    warn(
      { errName: error instanceof Error ? error.name : "UnknownError" },
      "[langfuse-handler] flushAsync failed on shutdown"
    );
  }
}
