import OpenAI, { toFile } from "openai";
import type {
  SpeechTranscriber,
  TranscribeInput,
  TranscribeResult,
} from "./speech-transcriber-port.js";
import type {
  SpeechSynthesizer,
  SynthesizeResult,
} from "./speech-synthesizer-port.js";

/**
 * OpenAI-audio adapter for speech-to-text (13-v1.1-interactive-voice-chat, A1).
 *
 * This is the ONLY place the `openai` SDK enters the transcribe path — the route
 * (`plan.ts`) depends on the `SpeechTranscriber` port, never on `openai`, so the
 * deps-guard/architecture confinement (AI code lives only under
 * `apps/api/src/ai/`, `openai` confined to `apps/api`) holds.
 *
 * Model is pinned to `whisper-1` (design.md decision) in ONE constant, so a
 * later swap to `gpt-4o-transcribe` is a one-line change behind the unchanged
 * port. The route, UI, and tests never see the model name.
 *
 * KEY HANDLING (matches every existing adapter — `adapter-factory.ts`): the
 * dedicated `OPENAI_API_KEY` is read at CALL time via the injected client
 * factory, never at construction, so an absent key does not crash boot — only a
 * live call fails. Voice uses a dedicated key decoupled from the dynamic
 * `ai_provider_config` chat provider. The key and raw audio are NEVER logged.
 *
 * Tests inject a deterministic fake client — no network.
 */

/** Model pinned in one place (design.md — `whisper-1` for STT). */
const STT_MODEL = "whisper-1";

/**
 * TTS pinned in one place (design.md — `gpt-4o-mini-tts`, voice `alloy`, mp3).
 * A later model/voice swap is a one-line change behind the unchanged
 * `SpeechSynthesizer` port — the route, UI, and tests never see these names.
 */
const TTS_MODEL = "gpt-4o-mini-tts";
const TTS_VOICE = "alloy";
const TTS_RESPONSE_FORMAT = "mp3";

/**
 * OpenAI TTS input character cap (design.md — "bounded to OpenAI's ~4096-char
 * cap; longer replies are truncated at a sentence boundary server-side").
 * create-plan terminal replies are short, so this is a guard, not a common path.
 */
const TTS_MAX_INPUT_CHARS = 4096;

/**
 * Bound TTS input to the OpenAI cap, preferring a sentence boundary. If the text
 * is within the cap it is returned unchanged. Otherwise we cut at the last
 * sentence-ending punctuation (`.`, `!`, `?`) or newline that falls within the
 * cap; if none exists we hard-cut at the cap. This keeps a truncated reply
 * coherent instead of ending mid-word, and NEVER sends an over-cap request.
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
  if (lastBoundary > 0) return window.slice(0, lastBoundary + 1);
  return window;
}

/**
 * Minimal OpenAI-audio client surface the adapter needs. The real `OpenAI`
 * client satisfies this structurally; test fakes implement just this.
 */
export interface OpenAIAudioClient {
  audio: {
    transcriptions: {
      create(
        body: {
          file: unknown;
          model: string;
          language?: string;
        },
        options?: { signal?: AbortSignal },
      ): Promise<{ text: string }>;
    };
    speech: {
      create(
        body: {
          model: string;
          voice: string;
          input: string;
          response_format: string;
        },
        options?: { signal?: AbortSignal },
      ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
    };
  };
}

/** Builds a client for the given API key. Injected for testability. */
export type OpenAIAudioClientFactory = (apiKey: string | undefined) => OpenAIAudioClient;

/**
 * Bounded timeout + limited retries (review fix, resilience — mirrors the
 * Stripe gateway's `{ timeout: 10_000, maxNetworkRetries: 1 }`). The SDK
 * default (`timeout: 600_000` / 10 min, `maxRetries: 2`) would let a hung
 * Whisper call hold the route handler AND the in-memory 15 MB audio buffer for
 * up to 10 minutes, and a degraded provider would triple the upstream request
 * volume via silent retries. A short push-to-talk transcription has no reason
 * to wait that long — 45 s comfortably covers a slow real call while bounding
 * the worst case; at most one retry avoids amplifying an already-degraded
 * provider.
 */
const OPENAI_CLIENT_TIMEOUT_MS = 45_000;
const OPENAI_CLIENT_MAX_RETRIES = 1;

/** Production factory: reads the dedicated OPENAI_API_KEY at call time. */
const defaultClientFactory: OpenAIAudioClientFactory = (apiKey) =>
  new OpenAI({
    apiKey: apiKey ?? "placeholder-key",
    timeout: OPENAI_CLIENT_TIMEOUT_MS,
    maxRetries: OPENAI_CLIENT_MAX_RETRIES,
  }) as unknown as OpenAIAudioClient;

/** Map a validated audio content type to a Whisper-friendly filename extension. */
function extensionFor(contentType: string): string {
  switch (contentType) {
    case "audio/webm":
      return "webm";
    case "audio/mp4":
      return "mp4";
    case "audio/x-m4a":
    case "audio/m4a":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    default:
      return "bin";
  }
}

export class OpenAIAudioAdapter implements SpeechTranscriber, SpeechSynthesizer {
  private readonly clientFactory: OpenAIAudioClientFactory;

  constructor(clientFactory: OpenAIAudioClientFactory = defaultClientFactory) {
    this.clientFactory = clientFactory;
  }

  async transcribe(input: TranscribeInput, signal?: AbortSignal): Promise<TranscribeResult> {
    // Read the dedicated key at call time (never at construction) and build the
    // client through the injectable factory. Never log the key or raw audio.
    const client = this.clientFactory(process.env["OPENAI_API_KEY"]);

    const file = await toFile(Buffer.from(input.audio), `audio.${extensionFor(input.contentType)}`, {
      type: input.contentType,
    });

    const body: { file: unknown; model: string; language?: string } = {
      file,
      model: STT_MODEL,
    };
    if (input.language) body.language = input.language;

    const response = await client.audio.transcriptions.create(
      body,
      signal ? { signal } : undefined,
    );

    const text = (response.text ?? "").trim();
    if (text.length === 0) {
      return { text: "", unclear: true };
    }
    return { text, unclear: false };
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<SynthesizeResult> {
    // Read the dedicated key at call time (never at construction) and build the
    // client through the injectable factory. Never log the key or the text.
    const client = this.clientFactory(process.env["OPENAI_API_KEY"]);

    // Bound the input to the OpenAI cap at a sentence boundary BEFORE the call,
    // so an over-cap reply never reaches OpenAI.
    const input = truncateForTts(text);

    const response = await client.audio.speech.create(
      {
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input,
        response_format: TTS_RESPONSE_FORMAT,
      },
      signal ? { signal } : undefined,
    );

    const buffer = await response.arrayBuffer();
    return { audio: new Uint8Array(buffer), contentType: "audio/mpeg" };
  }
}
