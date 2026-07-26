import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIAudioAdapter } from "../openai-audio-adapter.js";
import type { OpenAIAudioClient } from "../openai-audio-adapter.js";
import type { TranscribeInput } from "../speech-transcriber-port.js";

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
});
