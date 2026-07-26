import OpenAI, { toFile } from "openai";
import type {
  SpeechTranscriber,
  TranscribeInput,
  TranscribeResult,
} from "./speech-transcriber-port.js";

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
  };
}

/** Builds a client for the given API key. Injected for testability. */
export type OpenAIAudioClientFactory = (apiKey: string | undefined) => OpenAIAudioClient;

/** Production factory: reads the dedicated OPENAI_API_KEY at call time. */
const defaultClientFactory: OpenAIAudioClientFactory = (apiKey) =>
  new OpenAI({ apiKey: apiKey ?? "placeholder-key" }) as unknown as OpenAIAudioClient;

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

export class OpenAIAudioAdapter implements SpeechTranscriber {
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
}
