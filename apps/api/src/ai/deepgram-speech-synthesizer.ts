import type {
  SpeechSynthesizer,
  SynthesizeResult,
} from "./speech-synthesizer-port.js";
import {
  DEFAULT_BACKOFF_MS,
  fetchWithTransientRetry,
} from "./retry-transient.js";
import { ProviderRateLimitError } from "./provider-errors.js";

/**
 * Deepgram (Aura-2) adapter for text-to-speech
 * (feat/deepgram-stt — second alternative TTS provider after Google/Gemini,
 * paired with the Deepgram STT adapter on this branch).
 *
 * This mirrors `GeminiSpeechSynthesizer` behind the SAME `SpeechSynthesizer`
 * port — the route (`plan.ts`) depends only on the port, never on this adapter,
 * so the deps-guard/architecture confinement (AI code lives only under
 * `apps/api/src/ai/`) holds. Like the Gemini adapter it uses NO SDK: it calls
 * Deepgram's synchronous REST `/v1/speak` endpoint through the global `fetch`,
 * so it adds NO new runtime dependency.
 *
 * KEY HANDLING (matches every existing adapter — `DeepgramSpeechTranscriber` +
 * `GeminiSpeechSynthesizer`): the dedicated `DEEPGRAM_API_KEY` is read at CALL
 * time, never at construction, so an absent key does not crash boot — only a
 * live call fails. The key, the request URL, and the text are NEVER logged and
 * are NEVER placed in a thrown error message.
 *
 * MODEL (voice) is read from `DEEPGRAM_TTS_MODEL` (default `aura-2-carina-es`)
 * in ONE place, so swapping the voice is a config change behind the unchanged
 * port. `aura-2-carina-es` is a feminine PENINSULAR (es-es) voice that also
 * handles ES/EN code-switching, so — unlike the Gemini adapter — NO style /
 * accent-directive prompt hack is needed to steer the accent toward Castilian.
 * Other es-es Aura-2 voices (swap via `DEEPGRAM_TTS_MODEL`):
 *   feminine: aura-2-carina-es, aura-2-diana-es, aura-2-agustina-es,
 *             aura-2-silvia-es
 *   masculine: aura-2-nestor-es, aura-2-alvaro-es
 *
 * AUDIO FORMAT: the request pins `encoding=linear16&sample_rate=24000&
 * container=wav`, so Deepgram returns a COMPLETE, container-wrapped WAV file as
 * the raw response body. Unlike Gemini (raw PCM that must be wrapped in a
 * 44-byte header), this adapter does NO manual WAV wrapping — it reads the body
 * via `arrayBuffer()` and returns those bytes verbatim as `audio/wav`.
 *
 * Tests inject a deterministic fake `fetch` — no network.
 */

/** Voice model pinned in one place; overridable via env for a later swap. */
const DEFAULT_TTS_MODEL = "aura-2-carina-es";

/** Deepgram synchronous speak endpoint (audio bytes returned as the body). */
const DEEPGRAM_SPEAK_BASE = "https://api.deepgram.com/v1/speak";

/**
 * Bounded timeout matching the sibling adapters (`DEEPGRAM_CLIENT_TIMEOUT_MS`
 * in the STT adapter / `GOOGLE_CLIENT_TIMEOUT_MS`). A short terminal-reply
 * synthesis has no reason to hold the route handler longer than this; the
 * caller's own AbortSignal can cut it shorter.
 */
const DEEPGRAM_CLIENT_TIMEOUT_MS = 45_000;

/**
 * Deepgram Aura `/v1/speak` accepts up to ~2000 characters per synchronous
 * request — a SMALLER cap than the Gemini adapter's 4096. create-plan terminal
 * replies are short, so this is a guard, not a common path.
 */
const TTS_MAX_INPUT_CHARS = 2000;

/**
 * Bound TTS input to the 2000-char cap, preferring a sentence boundary. Same
 * logic as the Gemini adapter's `truncateForTts`, just a smaller cap: within
 * the cap → unchanged; otherwise cut at the last sentence-ending punctuation
 * (`.`, `!`, `?`) or newline within the cap, else hard-cut. Never returns a
 * blank result for non-empty input (a whitespace-heavy prefix falls back to a
 * leading-stripped hard cut).
 */
function truncateForTts(text: string): string {
  if (text.length <= TTS_MAX_INPUT_CHARS) return text;

  const window = text.slice(0, TTS_MAX_INPUT_CHARS);
  const lastBoundary = Math.max(
    window.lastIndexOf("."),
    window.lastIndexOf("!"),
    window.lastIndexOf("?"),
    window.lastIndexOf("\n"),
  );
  if (lastBoundary > 0) {
    const bounded = window.slice(0, lastBoundary + 1);
    if (bounded.trim().length > 0) return bounded;
  }

  const trimmedLeading = text.replace(/^\s+/, "");
  const hardCut = trimmedLeading.slice(0, TTS_MAX_INPUT_CHARS);
  return hardCut.trim().length > 0 ? hardCut : window;
}

/** Build the `?model=...&encoding=linear16&sample_rate=24000&container=wav` query. */
function buildQuery(model: string): string {
  const params = new URLSearchParams({
    model,
    encoding: "linear16",
    sample_rate: "24000",
    container: "wav",
  });
  return params.toString();
}

/**
 * Injectable `fetch`-shaped client for testability, matching the STT adapter's
 * `DeepgramFetch` auth shape. The default calls the global `fetch`; tests
 * inject a fake so no network is hit. Unlike the STT adapter (which reads JSON)
 * the `/v1/speak` response body IS the raw audio, so the modeled response
 * exposes `arrayBuffer()` rather than `json()`. Only the fields the adapter
 * needs are modeled.
 */
export type DeepgramFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Production fetch: delegates to the global `fetch` (no SDK, no new dep). */
const defaultFetch: DeepgramFetch = (url, init) =>
  fetch(url, init) as unknown as Promise<{
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;

export class DeepgramSpeechSynthesizer implements SpeechSynthesizer {
  private readonly fetchImpl: DeepgramFetch;
  private readonly backoffMs: readonly number[];

  /**
   * `backoffMs` overrides the retry delays between transient-error attempts
   * (429/503/500/502/504) — defaults to the production `DEFAULT_BACKOFF_MS`
   * (400ms, 800ms). Tests pass `[0, 0]` so they never actually sleep.
   */
  constructor(
    fetchImpl: DeepgramFetch = defaultFetch,
    backoffMs: readonly number[] = DEFAULT_BACKOFF_MS,
  ) {
    this.fetchImpl = fetchImpl;
    this.backoffMs = backoffMs;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesizeResult> {
    // Honor an already-aborted caller signal BEFORE any work / network call,
    // mirroring how the sibling adapters reject on an aborted signal.
    if (signal?.aborted) {
      throw new Error("Deepgram TTS synthesis aborted");
    }

    // Read the dedicated key at CALL time (never at construction). Never log it
    // and never place it in a thrown error.
    const apiKey = process.env["DEEPGRAM_API_KEY"] ?? "placeholder-key";
    const model = process.env["DEEPGRAM_TTS_MODEL"] ?? DEFAULT_TTS_MODEL;
    const url = `${DEEPGRAM_SPEAK_BASE}?${buildQuery(model)}`;

    // Bound the text at a sentence boundary. The text is NEVER logged.
    const requestBody = JSON.stringify({ text: truncateForTts(text) });

    // Race an internal bounded timeout AND the caller's signal via a linked
    // AbortController: aborting either aborts the fetch. Always clear the timer.
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), DEEPGRAM_CLIENT_TIMEOUT_MS);

    let response: { status: number; arrayBuffer(): Promise<ArrayBuffer> };
    try {
      response = await fetchWithTransientRetry(
        () =>
          this.fetchImpl(url, {
            method: "POST",
            // `Authorization: Token <key>` is Deepgram's scheme (same as the STT
            // adapter). The body is JSON `{ text }`. The key and text are NEVER
            // logged.
            headers: {
              Authorization: `Token ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: requestBody,
            signal: controller.signal,
          }),
        { backoffMs: this.backoffMs, signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
    }

    if (response.status !== 200) {
      // A TERMINAL 429 (retries in fetchWithTransientRetry are exhausted) is a
      // rate-limit/quota-exhausted failure, not a generic transport error —
      // classify it distinctly so the route can log/respond accordingly.
      // Any OTHER non-2xx keeps throwing the generic error. NEVER include the
      // key, the URL (which carries no key here but stays out anyway), or text.
      if (response.status === 429) {
        throw new ProviderRateLimitError("deepgram", "tts");
      }
      throw new Error(`Deepgram TTS request failed with status ${response.status}`);
    }

    const audio = new Uint8Array(await response.arrayBuffer());

    if (audio.byteLength === 0) {
      // Fail closed like the Gemini adapter — the route maps this to 502.
      throw new Error("Deepgram TTS response contained no audio");
    }

    return { audio, contentType: "audio/wav" };
  }
}
