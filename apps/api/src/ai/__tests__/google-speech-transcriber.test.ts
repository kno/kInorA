import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GoogleSpeechTranscriber,
  type GoogleGenAiFetch,
} from "../google-speech-transcriber.js";
import type { TranscribeInput } from "../speech-transcriber-port.js";
import { ProviderRateLimitError } from "../provider-errors.js";

/**
 * The adapter is constructed with an injectable `fetch`-shaped client so tests
 * never touch the network. Each fake records the URL + init it was called with
 * and returns a canned `generateContent` response body.
 */
function makeFakeFetch(
  responseBody: unknown,
  opts?: { status?: number },
): {
  fetchImpl: GoogleGenAiFetch;
  calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }>;
} {
  const calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }> = [];
  const fetchImpl: GoogleGenAiFetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return {
      status: opts?.status ?? 200,
      json: async () => responseBody,
    };
  });
  return { fetchImpl, calls };
}

/**
 * A fake fetch that returns a scripted sequence of statuses (one per call),
 * repeating the last entry once the sequence is exhausted. Used to prove the
 * shared transient-error retry (`retry-transient.ts`) is wired in.
 */
function makeSequencedFetch(
  statuses: number[],
  responseBody: unknown,
): {
  fetchImpl: GoogleGenAiFetch;
  calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }>;
} {
  const calls: Array<{ url: string; init: Parameters<GoogleGenAiFetch>[1] }> = [];
  let callIndex = 0;
  const fetchImpl: GoogleGenAiFetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(callIndex, statuses.length - 1)]!;
    callIndex += 1;
    return {
      status,
      json: async () => responseBody,
    };
  });
  return { fetchImpl, calls };
}

/** Build a normal Gemini generateContent success body with the given text. */
function geminiTextResponse(text: string): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
      },
    ],
  };
}

const input: TranscribeInput = {
  audio: new Uint8Array([1, 2, 3, 4]),
  contentType: "audio/wav",
};

describe("GoogleSpeechTranscriber — transcribe", () => {
  const OLD_KEY = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  const OLD_MODEL = process.env["GOOGLE_STT_MODEL"];

  beforeEach(() => {
    process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = "google-test-key";
    delete process.env["GOOGLE_STT_MODEL"];
  });

  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
    else process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = OLD_KEY;
    if (OLD_MODEL === undefined) delete process.env["GOOGLE_STT_MODEL"];
    else process.env["GOOGLE_STT_MODEL"] = OLD_MODEL;
    vi.restoreAllMocks();
  });

  it("builds a generateContent request with the model + key in the URL and inline base64 audio + the transcribe prompt + temperature 0", async () => {
    const { fetchImpl, calls } = makeFakeFetch(
      geminiTextResponse("build muscle four days a week"),
    );
    const adapter = new GoogleSpeechTranscriber(fetchImpl);

    const result = await adapter.transcribe(input);

    expect(result).toEqual({
      text: "build muscle four days a week",
      unclear: false,
    });
    expect(calls).toHaveLength(1);

    const { url, init } = calls[0]!;
    // Default model + key in the URL.
    expect(url).toContain("gemini-2.5-flash");
    expect(url).toContain(":generateContent");
    expect(url).toContain("key=google-test-key");
    expect(url).toContain("generativelanguage.googleapis.com");

    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      contents: Array<{
        parts: Array<{
          text?: string;
          inline_data?: { mime_type: string; data: string };
        }>;
      }>;
      generationConfig?: { temperature?: number };
    };

    // inline_data with the correct mime type + base64 of the audio bytes.
    const parts = body.contents[0]!.parts;
    const inlinePart = parts.find((p) => p.inline_data);
    expect(inlinePart?.inline_data?.mime_type).toBe("audio/wav");
    expect(inlinePart?.inline_data?.data).toBe(
      Buffer.from(input.audio).toString("base64"),
    );

    // The transcribe prompt text is present.
    const textPart = parts.find((p) => typeof p.text === "string");
    expect(textPart?.text).toBeDefined();
    expect((textPart!.text as string).length).toBeGreaterThan(0);

    // Deterministic decoding.
    expect(body.generationConfig?.temperature).toBe(0);
  });

  it("passes the input.contentType straight through as the inline mime type (webm compatibility risk surfaced to Gemini, not silently rewritten)", async () => {
    const { fetchImpl, calls } = makeFakeFetch(geminiTextResponse("hi"));
    const adapter = new GoogleSpeechTranscriber(fetchImpl);

    await adapter.transcribe({ ...input, contentType: "audio/webm" });

    const body = JSON.parse(calls[0]!.init.body as string) as {
      contents: Array<{ parts: Array<{ inline_data?: { mime_type: string } }> }>;
    };
    const inlinePart = body.contents[0]!.parts.find((p) => p.inline_data);
    expect(inlinePart?.inline_data?.mime_type).toBe("audio/webm");
  });

  it("includes the language hint in the prompt when provided", async () => {
    const { fetchImpl, calls } = makeFakeFetch(geminiTextResponse("hola"));
    const adapter = new GoogleSpeechTranscriber(fetchImpl);

    await adapter.transcribe({ ...input, language: "Spanish" });

    const body = JSON.parse(calls[0]!.init.body as string) as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
    };
    const textPart = body.contents[0]!.parts.find((p) => typeof p.text === "string");
    expect((textPart!.text as string).toLowerCase()).toContain("spanish");
  });

  it("uses GOOGLE_STT_MODEL when set", async () => {
    process.env["GOOGLE_STT_MODEL"] = "gemini-3.0-pro";
    const { fetchImpl, calls } = makeFakeFetch(geminiTextResponse("ok"));
    const adapter = new GoogleSpeechTranscriber(fetchImpl);

    await adapter.transcribe(input);

    expect(calls[0]!.url).toContain("gemini-3.0-pro");
  });

  it("parses a normal transcript across multiple parts → {text, unclear:false}", async () => {
    const { fetchImpl } = makeFakeFetch({
      candidates: [
        { content: { parts: [{ text: "build muscle " }, { text: "four days" }] } },
      ],
    });
    const adapter = new GoogleSpeechTranscriber(fetchImpl);

    expect(await adapter.transcribe(input)).toEqual({
      text: "build muscle four days",
      unclear: false,
    });
  });

  it("maps an empty transcript to {text:'', unclear:true}", async () => {
    const { fetchImpl } = makeFakeFetch(geminiTextResponse(""));
    const adapter = new GoogleSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("maps a whitespace-only transcript to {text:'', unclear:true}", async () => {
    const { fetchImpl } = makeFakeFetch(geminiTextResponse("   \n\t  "));
    const adapter = new GoogleSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("maps a response with no candidates to {text:'', unclear:true}", async () => {
    const { fetchImpl } = makeFakeFetch({ candidates: [] });
    const adapter = new GoogleSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("maps a response with no parts to {text:'', unclear:true}", async () => {
    const { fetchImpl } = makeFakeFetch({ candidates: [{ content: {} }] });
    const adapter = new GoogleSpeechTranscriber(fetchImpl);
    expect(await adapter.transcribe(input)).toEqual({ text: "", unclear: true });
  });

  it("reads GOOGLE_GENERATIVE_AI_API_KEY at call time, not at construction", async () => {
    delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
    const { fetchImpl, calls } = makeFakeFetch(geminiTextResponse("hello"));
    // Construction must not have read/observed the key at all.
    const adapter = new GoogleSpeechTranscriber(fetchImpl);
    expect(calls).toHaveLength(0);

    process.env["GOOGLE_GENERATIVE_AI_API_KEY"] = "late-key";
    await adapter.transcribe(input);

    expect(calls[0]!.url).toContain("key=late-key");
  });

  it("throws a generic error on a non-200 response without leaking the key", async () => {
    const { fetchImpl } = makeFakeFetch(
      { error: { message: "bad request" } },
      { status: 400 },
    );
    const adapter = new GoogleSpeechTranscriber(fetchImpl);

    await expect(adapter.transcribe(input)).rejects.toThrow();
    await expect(adapter.transcribe(input)).rejects.not.toThrow(
      /google-test-key/,
    );
  });

  it("never puts the key in a thrown error message", async () => {
    const { fetchImpl } = makeFakeFetch(
      { error: { message: "boom" } },
      { status: 500 },
    );
    // 500 is a transient status (retried) — zero the backoff so this test
    // doesn't actually sleep through real retries.
    const adapter = new GoogleSpeechTranscriber(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.transcribe(input);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const serialized = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("google-test-key");
  });

  it("honors an already-aborted signal: returns/throws WITHOUT calling fetch", async () => {
    const { fetchImpl, calls } = makeFakeFetch(geminiTextResponse("ignored"));
    const adapter = new GoogleSpeechTranscriber(fetchImpl);
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.transcribe(input, controller.signal),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("forwards an AbortSignal into the fetch init", async () => {
    const { fetchImpl, calls } = makeFakeFetch(geminiTextResponse("ok"));
    const adapter = new GoogleSpeechTranscriber(fetchImpl);
    const controller = new AbortController();

    await adapter.transcribe(input, controller.signal);

    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries a transient 503 and succeeds on the following 200 (zeroed backoff)", async () => {
    const { fetchImpl, calls } = makeSequencedFetch(
      [503, 200],
      geminiTextResponse("build muscle four days a week"),
    );
    const adapter = new GoogleSpeechTranscriber(fetchImpl, [0, 0]);

    const result = await adapter.transcribe(input);

    expect(result).toEqual({
      text: "build muscle four days a week",
      unclear: false,
    });
    expect(calls).toHaveLength(2);
  });

  it("does not retry a non-transient 400 and throws immediately without leaking the key", async () => {
    const { fetchImpl, calls } = makeFakeFetch(
      { error: { message: "bad request" } },
      { status: 400 },
    );
    const adapter = new GoogleSpeechTranscriber(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.transcribe(input);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    const serialized = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("google-test-key");
    expect(calls).toHaveLength(1);
  });

  it("a TERMINAL 429 (retries exhausted) throws ProviderRateLimitError('gemini','stt'), not the generic error", async () => {
    const { fetchImpl } = makeFakeFetch({ error: { message: "quota" } }, { status: 429 });
    const adapter = new GoogleSpeechTranscriber(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.transcribe(input);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ProviderRateLimitError);
    expect((caught as ProviderRateLimitError).provider).toBe("gemini");
    expect((caught as ProviderRateLimitError).feature).toBe("stt");
    const serialized = `${(caught as Error).message}\n${(caught as Error).stack ?? ""}`;
    expect(serialized).not.toContain("google-test-key");
  });

  it("a terminal 400 still throws the GENERIC error, not ProviderRateLimitError", async () => {
    const { fetchImpl } = makeFakeFetch(
      { error: { message: "bad request" } },
      { status: 400 },
    );
    const adapter = new GoogleSpeechTranscriber(fetchImpl, [0, 0]);

    let caught: unknown;
    try {
      await adapter.transcribe(input);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ProviderRateLimitError);
  });
});
