/**
 * Typed error distinguishing a provider RATE-LIMIT / quota-exhausted failure
 * from a generic transport/provider failure (feat/voice-provider-adapters —
 * make a hard Gemini 429 clearly visible in the server logs, distinct from a
 * generic 502/`chat_stream_failed`).
 *
 * The `retry-transient.ts` helper already retries a transient 429 a few times
 * — this error classifies only the TERMINAL failure after retries are
 * exhausted (or a non-retried 429 in the chat path, detected via message
 * sniffing — see `isLikelyRateLimitMessage`).
 *
 * The message is a FIXED, generic string. It MUST NEVER contain the API key,
 * the request URL (which carries the key), the prompt/transcript text, or the
 * raw audio — the adapters that throw this follow the exact same
 * never-leak-key/text discipline as their generic error path.
 */
export class ProviderRateLimitError extends Error {
  readonly provider: string;
  readonly feature: string;

  constructor(provider: string, feature: string) {
    super(`${provider} rate limit / quota exceeded`);
    this.name = "ProviderRateLimitError";
    this.provider = provider;
    this.feature = feature;
  }
}
