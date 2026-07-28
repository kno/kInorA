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
 * Google (Gemini) adapter for text-to-speech
 * (feat/voice-provider-adapters — first alternative TTS provider, enables a
 * fully OpenAI-free voice stack alongside `GoogleSpeechTranscriber`).
 *
 * This mirrors `OpenAIAudioAdapter.synthesize` behind the SAME
 * `SpeechSynthesizer` port — the route (`plan.ts`) depends only on the port and
 * sends `result.contentType` through unchanged, so the deps-guard/architecture
 * confinement (AI code lives only under `apps/api/src/ai/`) holds. Like the
 * sibling Google STT adapter it uses NO SDK: it calls the Gemini REST
 * `generateContent` endpoint through the global `fetch`, so it adds NO new
 * runtime dependency.
 *
 * KEY HANDLING (matches every existing adapter — `GoogleSpeechTranscriber` +
 * `OpenAIAudioAdapter`): the dedicated `GOOGLE_GENERATIVE_AI_API_KEY` is read at
 * CALL time, never at construction, so an absent key does not crash boot — only
 * a live call fails. The key and the text are NEVER logged and are NEVER placed
 * in a thrown error message.
 *
 * MODEL is read from `GOOGLE_TTS_MODEL` (default `gemini-2.5-flash-preview-tts`)
 * and VOICE from `GOOGLE_TTS_VOICE` (default `Kore`) in ONE place each, so a
 * later swap is a config change behind the unchanged port. `-pro-preview-tts` is
 * quota-limited; the flash model is the verified default.
 *
 * AUDIO FORMAT: Gemini TTS returns inline RAW PCM (signed 16-bit little-endian,
 * mono, typically 24000 Hz), advertised as `audio/L16;codec=pcm;rate=NNNN`. Raw
 * PCM is not directly playable by `<audio>`/Expo, so this adapter wraps it in a
 * 44-byte canonical WAV header (see `wrapPcmInWavHeader`) and returns
 * `audio/wav`. The sample rate is parsed from the mime type (default 24000).
 *
 * Tests inject a deterministic fake `fetch` — no network.
 */

/** TTS model pinned in one place; overridable via env for a later swap. */
const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";

/** Prebuilt voice pinned in one place; overridable via env. */
const DEFAULT_TTS_VOICE = "Kore";

/** Default PCM sample rate when the mime type omits/garbles `rate=NNNN`. */
const DEFAULT_SAMPLE_RATE = 24_000;

/** Gemini TTS emits mono, signed 16-bit little-endian PCM. */
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/** Gemini REST base — the model + `:generateContent` are appended per call. */
const GENERATIVE_LANGUAGE_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Bounded timeout matching the STT adapter (`GOOGLE_CLIENT_TIMEOUT_MS`). A short
 * terminal-reply synthesis has no reason to hold the route handler longer than
 * this; the caller's own AbortSignal can cut it shorter.
 */
const GOOGLE_CLIENT_TIMEOUT_MS = 45_000;

/**
 * Gemini TTS input character cap. Mirrors the OpenAI adapter's ~4096-char guard;
 * create-plan terminal replies are short, so this is a guard, not a common path.
 */
const TTS_MAX_INPUT_CHARS = 4096;

/**
 * Bound TTS input to the cap, preferring a sentence boundary. Mirrors the
 * OpenAI adapter's `truncateForTts`: within the cap → unchanged; otherwise cut
 * at the last sentence-ending punctuation (`.`, `!`, `?`) or newline within the
 * cap, else hard-cut. Never returns a blank result for non-empty input (a
 * whitespace-heavy prefix falls back to a leading-stripped hard cut).
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

/**
 * Parse the PCM sample rate from a Gemini inline mime type such as
 * `audio/L16;codec=pcm;rate=24000`. Returns `DEFAULT_SAMPLE_RATE` when the mime
 * type is absent or the `rate=` token is missing/non-numeric.
 */
export function parseSampleRate(mimeType: string | undefined): number {
  if (!mimeType) return DEFAULT_SAMPLE_RATE;
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) return DEFAULT_SAMPLE_RATE;
  const rate = Number.parseInt(match[1]!, 10);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SAMPLE_RATE;
}

/**
 * Wrap raw mono/16-bit little-endian PCM in a canonical 44-byte WAV header.
 *
 * Pure + unit-testable. Layout (all multi-byte fields little-endian):
 * `RIFF` | ChunkSize=36+dataLen | `WAVE` | `fmt ` | Subchunk1Size=16 |
 * AudioFormat=1(PCM) | NumChannels=1 | SampleRate | ByteRate=rate*2 |
 * BlockAlign=2 | BitsPerSample=16 | `data` | Subchunk2Size=dataLen | <PCM>.
 */
export function wrapPcmInWavHeader(
  pcm: Uint8Array,
  sampleRate: number,
): Uint8Array {
  const dataLen = pcm.byteLength;
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const byteRate = sampleRate * blockAlign;

  const out = new Uint8Array(44 + dataLen);
  const view = new DataView(out.buffer);

  // Helper to write 4 ASCII chars at an offset.
  const writeTag = (offset: number, tag: string): void => {
    for (let i = 0; i < tag.length; i += 1) {
      out[offset + i] = tag.charCodeAt(i);
    }
  };

  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataLen, true); // ChunkSize
  writeTag(8, "WAVE");

  writeTag(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (PCM)
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeTag(36, "data");
  view.setUint32(40, dataLen, true); // Subchunk2Size

  out.set(pcm, 44);
  return out;
}

/**
 * Injectable `fetch`-shaped client for testability, matching the STT adapter's
 * `GoogleGenAiFetch`. The default calls the global `fetch`; tests inject a fake
 * so no network is hit.
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

/** Minimal shape of the Gemini `generateContent` TTS response we read. */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
  }>;
}

export class GeminiSpeechSynthesizer implements SpeechSynthesizer {
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

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesizeResult> {
    // Honor an already-aborted caller signal BEFORE any work / network call.
    if (signal?.aborted) {
      throw new Error("Google TTS synthesis aborted");
    }

    // Read the dedicated key at CALL time (never at construction). Never log it
    // and never place it in a thrown error.
    const apiKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"] ?? "placeholder-key";
    const model = process.env["GOOGLE_TTS_MODEL"] ?? DEFAULT_TTS_MODEL;
    const voice = process.env["GOOGLE_TTS_VOICE"] ?? DEFAULT_TTS_VOICE;
    const url = `${GENERATIVE_LANGUAGE_BASE}/${model}:generateContent?key=${apiKey}`;

    // Bound the input at a sentence boundary BEFORE the call. The text is NEVER
    // logged.
    const input = truncateForTts(text);

    const requestBody = {
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
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
      // key, the URL (which carries the key), or the text.
      if (response.status === 429) {
        throw new ProviderRateLimitError("gemini", "tts");
      }
      throw new Error(`Google TTS request failed with status ${response.status}`);
    }

    const body = (await response.json()) as GenerateContentResponse;
    const inlineData = body.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data,
    )?.inlineData;
    const base64 = inlineData?.data;

    if (!base64 || base64.length === 0) {
      // Fail closed like the OpenAI adapter — the route maps this to 502.
      throw new Error("Google TTS response contained no audio");
    }

    const pcm = new Uint8Array(Buffer.from(base64, "base64"));
    const sampleRate = parseSampleRate(inlineData?.mimeType);
    const audio = wrapPcmInWavHeader(pcm, sampleRate);

    return { audio, contentType: "audio/wav" };
  }
}
