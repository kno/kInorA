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
 * Google (Gemini multimodal) adapter for speech-to-text
 * (feat/voice-provider-adapters — first alternative STT provider).
 *
 * This mirrors `OpenAIAudioAdapter` behind the SAME `SpeechTranscriber` port —
 * the route (`plan.ts`) depends only on the port, never on this adapter, so the
 * deps-guard/architecture confinement (AI code lives only under
 * `apps/api/src/ai/`) holds. Unlike the OpenAI adapter it uses NO SDK: it calls
 * the Gemini REST `generateContent` endpoint through the global `fetch`, so it
 * adds NO new runtime dependency.
 *
 * KEY HANDLING (matches every existing adapter — `adapter-factory.ts` +
 * `OpenAIAudioAdapter`): the dedicated `GOOGLE_GENERATIVE_AI_API_KEY` is read at
 * CALL time, never at construction, so an absent key does not crash boot — only
 * a live call fails. The key and the raw audio are NEVER logged and are NEVER
 * placed in a thrown error message.
 *
 * MODEL is read from `GOOGLE_STT_MODEL` (default `gemini-2.5-flash`) in ONE
 * place so a later swap is a config change behind the unchanged port. The route,
 * UI, and tests never see the model name.
 *
 * ⚠️ AUDIO-FORMAT COMPATIBILITY RISK (verify with a real recording): Gemini's
 * supported inline audio mime types are a LIMITED set — audio/wav, audio/mp3,
 * audio/aac, audio/ogg, audio/flac, audio/aiff — and may NOT include the
 * audio/webm (web MediaRecorder) or audio/mp4 (Expo/iOS) that our mic actually
 * records. This adapter passes `input.contentType` straight through and lets
 * Gemini reject an unsupported type (mapped by the route to a generic 502),
 * rather than silently rewriting the mime type and risking a mistranscription.
 * Confirm end-to-end with a real clip before enabling `google` STT in prod.
 *
 * Tests inject a deterministic fake `fetch` — no network.
 */

/** Model pinned in one place; overridable via env for a later swap. */
const DEFAULT_STT_MODEL = "gemini-2.5-flash";

/** Gemini REST base — the model + `:generateContent` are appended per call. */
const GENERATIVE_LANGUAGE_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Bounded timeout matching the OpenAI adapter (`OPENAI_CLIENT_TIMEOUT_MS`). A
 * short push-to-talk transcription has no reason to hold the route handler and
 * the in-memory audio buffer longer than this; the caller's own AbortSignal can
 * cut it shorter.
 */
const GOOGLE_CLIENT_TIMEOUT_MS = 45_000;

/**
 * Single pinned transcribe prompt. Instructs Gemini to return ONLY the verbatim
 * transcription (no preamble/markdown/commentary) and an empty string for
 * silent/empty/unintelligible audio — so the parse below can map "" to the
 * `{ text: "", unclear: true }` "could not understand" contract, exactly like
 * the OpenAI adapter.
 */
const TRANSCRIBE_PROMPT =
  "Transcribe the audio verbatim. Return ONLY the exact spoken words as plain " +
  "text, with no preamble, no markdown, no quotation marks, and no commentary. " +
  "If the audio is silent, empty, or unintelligible, return an empty string.";

/**
 * Injectable `fetch`-shaped client for testability. The default calls the global
 * `fetch`; tests inject a fake so no network is hit. Only the fields the adapter
 * needs are modeled.
 */
export type GoogleGenAiFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Production fetch: delegates to the global `fetch` (no SDK, no new dep). */
const defaultFetch: GoogleGenAiFetch = (url, init) =>
  fetch(url, init) as unknown as Promise<{
    status: number;
    json(): Promise<unknown>;
  }>;

/** Minimal shape of the Gemini `generateContent` response we read. */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/** Build the language hint sentence appended to the prompt, when present. */
function languageHint(language: string | undefined): string {
  if (!language || language.trim().length === 0) return "";
  return ` The audio is in ${language.trim()}.`;
}

export class GoogleSpeechTranscriber implements SpeechTranscriber {
  private readonly fetchImpl: GoogleGenAiFetch;
  private readonly backoffMs: readonly number[];

  /**
   * `backoffMs` overrides the retry delays between transient-error attempts
   * (429/503/500/502/504) — defaults to the production `DEFAULT_BACKOFF_MS`
   * (400ms, 800ms). Tests pass `[0, 0]` so they never actually sleep.
   */
  constructor(
    fetchImpl: GoogleGenAiFetch = defaultFetch,
    backoffMs: readonly number[] = DEFAULT_BACKOFF_MS,
  ) {
    this.fetchImpl = fetchImpl;
    this.backoffMs = backoffMs;
  }

  async transcribe(input: TranscribeInput, signal?: AbortSignal): Promise<TranscribeResult> {
    // Honor an already-aborted caller signal BEFORE any work / network call,
    // mirroring how the OpenAI SDK rejects on an aborted signal.
    if (signal?.aborted) {
      throw new Error("Google STT transcription aborted");
    }

    // Read the dedicated key at CALL time (never at construction). Never log it
    // and never place it in a thrown error.
    const apiKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"] ?? "placeholder-key";
    const model = process.env["GOOGLE_STT_MODEL"] ?? DEFAULT_STT_MODEL;
    const url = `${GENERATIVE_LANGUAGE_BASE}/${model}:generateContent?key=${apiKey}`;

    // Pass input.contentType straight through as the inline mime type (see the
    // audio-format compatibility risk note above). Base64-encode the in-flight
    // audio; it is NEVER persisted or logged.
    const requestBody = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: input.contentType,
                data: Buffer.from(input.audio).toString("base64"),
              },
            },
            { text: `${TRANSCRIBE_PROMPT}${languageHint(input.language)}` },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    };

    // Race an internal bounded timeout AND the caller's signal via a linked
    // AbortController: aborting either aborts the fetch. Always clear the timer.
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), GOOGLE_CLIENT_TIMEOUT_MS);

    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await fetchWithTransientRetry(
        () =>
          this.fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
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
      // key, the URL (which carries the key), or the raw audio.
      if (response.status === 429) {
        throw new ProviderRateLimitError("gemini", "stt");
      }
      throw new Error(`Google STT request failed with status ${response.status}`);
    }

    const body = (await response.json()) as GenerateContentResponse;
    const text = (body.candidates ?? [])
      .flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    if (text.length === 0) {
      return { text: "", unclear: true };
    }
    return { text, unclear: false };
  }
}
