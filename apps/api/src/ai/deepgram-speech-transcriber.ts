import type {
  SpeechTranscriber,
  TranscribeInput,
  TranscribeResult,
} from "./speech-transcriber-port.js";
import {
  DEFAULT_BACKOFF_MS,
  fetchWithTransientRetry,
} from "./retry-transient.js";
import { ProviderRateLimitError } from "./provider-errors.js";

/**
 * Deepgram adapter for speech-to-text
 * (feat/deepgram-stt — second alternative STT provider after Google/Gemini).
 *
 * This mirrors `GoogleSpeechTranscriber` behind the SAME `SpeechTranscriber`
 * port — the route (`plan.ts`) depends only on the port, never on this adapter,
 * so the deps-guard/architecture confinement (AI code lives only under
 * `apps/api/src/ai/`) holds. Like the Google adapter it uses NO SDK: it calls
 * Deepgram's prerecorded (synchronous) REST `/v1/listen` endpoint through the
 * global `fetch`, so it adds NO new runtime dependency.
 *
 * KEY HANDLING (matches every existing adapter — `GoogleSpeechTranscriber` +
 * `OpenAIAudioAdapter`): the dedicated `DEEPGRAM_API_KEY` is read at CALL time,
 * never at construction, so an absent key does not crash boot — only a live
 * call fails. The key, the request URL, and the raw audio are NEVER logged and
 * are NEVER placed in a thrown error message.
 *
 * MODEL is read from `DEEPGRAM_STT_MODEL` (default `nova-2` — nova-2 has robust
 * Spanish support) and LANGUAGE from `DEEPGRAM_STT_LANGUAGE` (default `es`),
 * each in ONE place so a later swap (e.g. nova-3) is a config change behind the
 * unchanged port. The route, UI, and tests never see these values.
 *
 * AUDIO FORMAT: unlike Gemini's limited inline-audio mime allow-list, Deepgram
 * accepts the browser MediaRecorder container (audio/webm / opus) and the
 * Expo/iOS audio/mp4 DIRECTLY as the raw request body. `input.contentType` is
 * forwarded verbatim as the `Content-Type` header and the RAW binary audio
 * bytes are the body — NOT JSON, NOT base64.
 *
 * Tests inject a deterministic fake `fetch` — no network.
 */

/** Model pinned in one place; overridable via env for a later swap. */
const DEFAULT_STT_MODEL = "nova-2";

/** Language pinned in one place; overridable via env. */
const DEFAULT_STT_LANGUAGE = "es";

/** Deepgram prerecorded (synchronous) transcription endpoint. */
const DEEPGRAM_LISTEN_BASE = "https://api.deepgram.com/v1/listen";

/**
 * Bounded timeout matching the sibling adapters (`GOOGLE_CLIENT_TIMEOUT_MS` /
 * `OPENAI_CLIENT_TIMEOUT_MS`). A short push-to-talk transcription has no reason
 * to hold the route handler and the in-memory audio buffer longer than this;
 * the caller's own AbortSignal can cut it shorter.
 */
const DEEPGRAM_CLIENT_TIMEOUT_MS = 45_000;

/**
 * Injectable `fetch`-shaped client for testability. The default calls the
 * global `fetch`; tests inject a fake so no network is hit. Unlike the Google
 * adapter (JSON string body) the Deepgram body is the RAW binary audio, so the
 * `body` type here is `Uint8Array` (a valid `BodyInit`). Only the fields the
 * adapter needs are modeled.
 */
export type DeepgramFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Production fetch: delegates to the global `fetch` (no SDK, no new dep). */
const defaultFetch: DeepgramFetch = (url, init) =>
  fetch(url, init) as unknown as Promise<{
    status: number;
    json(): Promise<unknown>;
  }>;

/** Minimal shape of the Deepgram prerecorded response we read (defensively). */
interface DeepgramListenResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
      }>;
    }>;
  };
}

/** Build the `?model=...&language=...&smart_format=true` query string. */
function buildQuery(model: string, language: string): string {
  const params = new URLSearchParams({
    model,
    language,
    smart_format: "true",
  });
  return params.toString();
}

export class DeepgramSpeechTranscriber implements SpeechTranscriber {
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

  async transcribe(input: TranscribeInput, signal?: AbortSignal): Promise<TranscribeResult> {
    // Honor an already-aborted caller signal BEFORE any work / network call,
    // mirroring how the sibling adapters reject on an aborted signal.
    if (signal?.aborted) {
      throw new Error("Deepgram STT transcription aborted");
    }

    // Read the dedicated key at CALL time (never at construction). Never log it
    // and never place it in a thrown error.
    const apiKey = process.env["DEEPGRAM_API_KEY"] ?? "placeholder-key";
    const model = process.env["DEEPGRAM_STT_MODEL"] ?? DEFAULT_STT_MODEL;
    const language = process.env["DEEPGRAM_STT_LANGUAGE"] ?? DEFAULT_STT_LANGUAGE;
    const url = `${DEEPGRAM_LISTEN_BASE}?${buildQuery(model, language)}`;

    // Race an internal bounded timeout AND the caller's signal via a linked
    // AbortController: aborting either aborts the fetch. Always clear the timer.
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), DEEPGRAM_CLIENT_TIMEOUT_MS);

    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await fetchWithTransientRetry(
        () =>
          this.fetchImpl(url, {
            method: "POST",
            // `Authorization: Token <key>` is Deepgram's scheme. `Content-Type`
            // echoes the input mime (webm/opus/mp4 accepted directly). The raw
            // audio is NEVER persisted or logged.
            headers: {
              Authorization: `Token ${apiKey}`,
              "Content-Type": input.contentType,
            },
            body: input.audio,
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
      // key, the URL, or the raw audio.
      if (response.status === 429) {
        throw new ProviderRateLimitError("deepgram", "stt");
      }
      throw new Error(`Deepgram STT request failed with status ${response.status}`);
    }

    const body = (await response.json()) as DeepgramListenResponse;
    const text = (
      body.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ""
    ).trim();

    if (text.length === 0) {
      return { text: "", unclear: true };
    }
    return { text, unclear: false };
  }
}
