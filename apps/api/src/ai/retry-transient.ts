/**
 * Shared transient-error retry policy for the Google/Gemini REST adapters
 * (`GoogleSpeechTranscriber`, `GeminiSpeechSynthesizer`). Gemini's free tier
 * intermittently returns 429 (rate-limit) or 503 (UNAVAILABLE) for a moment —
 * without this, a single such blip fails the whole voice turn. Defined ONCE
 * here so both adapters share the exact same policy and it is unit-tested
 * once instead of duplicated per adapter.
 *
 * Only the response STATUS is inspected — never the body — so this stays
 * fully decoupled from each adapter's own request/response shape.
 */

/** Statuses worth retrying: rate-limit + common transient upstream errors. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/** `true` for a status considered a transient, worth-retrying failure. */
export function isTransientStatus(status: number): boolean {
  return TRANSIENT_STATUSES.has(status);
}

/**
 * Backoff between attempts in production: a short pause, then a longer one,
 * for up to 2 retries (3 attempts total). Simple fixed delays — no jitter.
 */
export const DEFAULT_BACKOFF_MS: readonly number[] = [400, 800];

export interface FetchWithTransientRetryOptions {
  /**
   * Delay (ms) awaited AFTER each transient attempt except the last. Its
   * length also bounds the number of retries: `backoffMs.length` retries,
   * i.e. `backoffMs.length + 1` total attempts. Defaults to
   * `DEFAULT_BACKOFF_MS` (2 retries). Tests should override with zeros so
   * they never actually sleep.
   */
  backoffMs?: readonly number[];
  /**
   * The caller's bounded/abortable signal. If it aborts while waiting
   * between attempts, retrying stops immediately — the last response
   * (or in-flight abort) is returned rather than sleeping past the abort.
   */
  signal?: AbortSignal;
}

/** Resolve after `ms`, or immediately if `signal` aborts first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `doFetch()` and retry it while the returned status is transient, up to
 * `backoffMs.length` additional attempts, waiting `backoffMs[attempt]`
 * between each. A non-transient status (success or a permanent error) is
 * returned immediately without retry. If the caller's `signal` aborts while
 * waiting between attempts, retrying stops and the last response is
 * returned as-is — never sleeps past an abort.
 */
export async function fetchWithTransientRetry<T extends { status: number }>(
  doFetch: () => Promise<T>,
  options: FetchWithTransientRetryOptions = {},
): Promise<T> {
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = backoffMs.length + 1;

  let lastResponse: T | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastResponse = await doFetch();

    if (!isTransientStatus(lastResponse.status)) return lastResponse;
    if (attempt === maxAttempts - 1) return lastResponse;
    if (options.signal?.aborted) return lastResponse;

    await sleep(backoffMs[attempt]!, options.signal);

    if (options.signal?.aborted) return lastResponse;
  }

  // Unreachable (loop always returns), but keeps TS satisfied.
  return lastResponse as T;
}
