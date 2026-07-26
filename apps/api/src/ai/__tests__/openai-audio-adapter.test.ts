import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIAudioAdapter } from "../openai-audio-adapter.js";
import type { OpenAIAudioClient } from "../openai-audio-adapter.js";
import type { TranscribeInput } from "../speech-transcriber-port.js";

/**
 * Review fix (resilience): the PRODUCTION client factory must construct the
 * real `OpenAI` SDK client with a bounded `timeout` + limited `maxRetries` —
 * not the SDK defaults (10 min timeout / 2 retries), which would let a hung
 * provider hold the handler + the in-memory audio buffer for up to 10 minutes
 * and would triple upstream request volume on a degraded provider. Mock the
 * `openai` module's default export so we can assert on the constructor options
 * WITHOUT any network call. Vitest hoists `vi.mock` calls above every import in
 * this file (including the static import of the adapter above), so the adapter
 * already sees this mocked `OpenAI` constructor.
 */
const openAIConstructorCalls: Array<Record<string, unknown>> = [];
vi.mock("openai", () => {
  class MockOpenAI {
    constructor(options: Record<string, unknown>) {
      openAIConstructorCalls.push(options);
    }
  }
  return {
    default: MockOpenAI,
    toFile: vi.fn(async (input: unknown, filename: string, opts: unknown) => ({
      input,
      filename,
      opts,
    })),
  };
});

/**
 * The adapter is constructed with an injectable OpenAI-audio client so tests
 * never touch the network. The fake records the call args and returns a canned
 * transcription.
 */
function makeFakeClient(transcript: string, opts?: { throwError?: Error }): {
  client: OpenAIAudioClient;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const client: OpenAIAudioClient = {
    audio: {
      transcriptions: {
        create: vi.fn(async (body: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.push({ ...body, ...(options ?? {}) });
          if (opts?.throwError) throw opts.throwError;
          return { text: transcript } as { text: string };
        }),
      },
    },
  };
  return { client, calls };
}

const input: TranscribeInput = {
  audio: new Uint8Array([1, 2, 3, 4]),
  contentType: "audio/webm",
};

describe("OpenAIAudioAdapter — transcribe", () => {
  const OLD_ENV = process.env["OPENAI_API_KEY"];

  beforeEach(() => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = OLD_ENV;
    vi.restoreAllMocks();
  });

  it("calls the injected client's audio.transcriptions.create with model whisper-1", async () => {
    const { client, calls } = makeFakeClient("build muscle four days a week");
    const adapter = new OpenAIAudioAdapter(() => client);

    const result = await adapter.transcribe(input);

    expect(result).toEqual({ text: "build muscle four days a week", unclear: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!["model"]).toBe("whisper-1");
    expect(calls[0]!["file"]).toBeDefined();
  });

  it("forwards the optional language hint when provided", async () => {
    const { client, calls } = makeFakeClient("hola");
    const adapter = new OpenAIAudioAdapter(() => client);

    await adapter.transcribe({ ...input, language: "es" });

    expect(calls[0]!["language"]).toBe("es");
  });

  it("does not send a language field when none is provided", async () => {
    const { client, calls } = makeFakeClient("hi");
    const adapter = new OpenAIAudioAdapter(() => client);

    await adapter.transcribe(input);

    expect(calls[0]!).not.toHaveProperty("language");
  });

  it("reads OPENAI_API_KEY at call time, not at construction", async () => {
    delete process.env["OPENAI_API_KEY"];
    const seenKeys: Array<string | undefined> = [];
    const adapter = new OpenAIAudioAdapter((apiKey) => {
      seenKeys.push(apiKey);
      return makeFakeClient("hello").client;
    });

    // Construction must not have read the key.
    expect(seenKeys).toHaveLength(0);

    process.env["OPENAI_API_KEY"] = "sk-late-key";
    await adapter.transcribe(input);

    expect(seenKeys).toEqual(["sk-late-key"]);
  });

  it("maps an empty transcript to {text:'', unclear:true}", async () => {
    const { client } = makeFakeClient("");
    const adapter = new OpenAIAudioAdapter(() => client);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("maps a whitespace-only transcript to {text:'', unclear:true}", async () => {
    const { client } = makeFakeClient("   \n\t  ");
    const adapter = new OpenAIAudioAdapter(() => client);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("forwards the AbortSignal into the SDK call", async () => {
    const { client, calls } = makeFakeClient("ok");
    const adapter = new OpenAIAudioAdapter(() => client);
    const controller = new AbortController();

    await adapter.transcribe(input, controller.signal);

    expect(calls[0]!["signal"]).toBe(controller.signal);
  });

  it("maps an injected client throw to a rejected promise (no unhandled crash)", async () => {
    const { client } = makeFakeClient("", { throwError: new Error("network down") });
    const adapter = new OpenAIAudioAdapter(() => client);

    await expect(adapter.transcribe(input)).rejects.toThrow("network down");
  });

  // --- Review fix: bounded timeout + limited retries on the PRODUCTION client ---

  it("constructs the default (production) OpenAI client with a bounded timeout and limited retries", async () => {
    openAIConstructorCalls.length = 0;
    // No factory injected — exercises the real `defaultClientFactory`, which
    // must construct the mocked `OpenAI` with resilience-bounded options
    // instead of the SDK's 10-minute-timeout / 2-retries defaults.
    const adapter = new OpenAIAudioAdapter();

    // The mocked client has no `audio.transcriptions.create` — the call rejects
    // after construction; only the constructor args matter for this assertion.
    await adapter.transcribe(input).catch(() => {});

    expect(openAIConstructorCalls).toHaveLength(1);
    const options = openAIConstructorCalls[0]!;
    expect(options["timeout"]).toBeTypeOf("number");
    expect(options["timeout"] as number).toBeGreaterThan(0);
    expect(options["timeout"] as number).toBeLessThanOrEqual(60_000);
    expect(options["maxRetries"]).toBeTypeOf("number");
    expect(options["maxRetries"] as number).toBeLessThanOrEqual(1);
  });
});

/**
 * A fake OpenAI-audio client for the TTS (speech) half. Records the create call
 * args and returns canned mp3 bytes via an `arrayBuffer()`-bearing response,
 * mirroring the real SDK's `audio.speech.create` return shape. No network.
 */
function makeFakeSpeechClient(bytes: Uint8Array = new Uint8Array([0x49, 0x44, 0x33])): {
  client: OpenAIAudioClient;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const client: OpenAIAudioClient = {
    audio: {
      transcriptions: {
        create: vi.fn(async () => ({ text: "" })),
      },
      speech: {
        create: vi.fn(async (body: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.push({ ...body, ...(options ?? {}) });
          return {
            arrayBuffer: async () =>
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          };
        }),
      },
    },
  };
  return { client, calls };
}

describe("OpenAIAudioAdapter — synthesize (TTS)", () => {
  const OLD_ENV = process.env["OPENAI_API_KEY"];

  beforeEach(() => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
  });

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = OLD_ENV;
    vi.restoreAllMocks();
  });

  it("pins model gpt-4o-mini-tts, voice alloy, response_format mp3 and returns audio/mpeg bytes", async () => {
    const { client, calls } = makeFakeSpeechClient(new Uint8Array([1, 2, 3, 4, 5]));
    const adapter = new OpenAIAudioAdapter(() => client);

    const result = await adapter.synthesize("great, four days a week");

    expect(result.contentType).toBe("audio/mpeg");
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.audio)).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!["model"]).toBe("gpt-4o-mini-tts");
    expect(calls[0]!["voice"]).toBe("alloy");
    expect(calls[0]!["response_format"]).toBe("mp3");
    expect(calls[0]!["input"]).toBe("great, four days a week");
  });

  it("truncates input beyond the ~4096-char cap at a sentence boundary BEFORE calling the client", async () => {
    const { client, calls } = makeFakeSpeechClient();
    const adapter = new OpenAIAudioAdapter(() => client);

    // Build > 4096 chars ending with sentences so a sentence boundary exists
    // within the cap window.
    const sentence = "This is a spoken reply sentence. ";
    const long = sentence.repeat(200); // ~6600 chars
    await adapter.synthesize(long);

    const sent = calls[0]!["input"] as string;
    expect(sent.length).toBeLessThanOrEqual(4096);
    // Cut at a sentence boundary — ends with the punctuation, not mid-word.
    expect(sent.trimEnd().endsWith(".")).toBe(true);
  });

  it("reads OPENAI_API_KEY at call time, not at construction", async () => {
    delete process.env["OPENAI_API_KEY"];
    const seenKeys: Array<string | undefined> = [];
    const adapter = new OpenAIAudioAdapter((apiKey) => {
      seenKeys.push(apiKey);
      return makeFakeSpeechClient().client;
    });

    expect(seenKeys).toHaveLength(0);

    process.env["OPENAI_API_KEY"] = "sk-late-key";
    await adapter.synthesize("hi");

    expect(seenKeys).toEqual(["sk-late-key"]);
  });

  it("forwards the AbortSignal into the SDK speech call", async () => {
    const { client, calls } = makeFakeSpeechClient();
    const adapter = new OpenAIAudioAdapter(() => client);
    const controller = new AbortController();

    await adapter.synthesize("ok", controller.signal);

    expect(calls[0]!["signal"]).toBe(controller.signal);
  });
});
