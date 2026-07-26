import { describe, expect, it, vi } from "vitest";
import {
  createFrameBuffer,
  runChatStream,
  type XhrLike,
} from "../chat-stream";
import type { ChatSSEEvent } from "../chat-types";

/**
 * Drive the ported pure frame buffer with an ordered list of text chunks —
 * the RN equivalent of feeding `parseSSEStream` a chunked `ReadableStream`.
 * Chunk boundaries are intentionally arbitrary so the buffer must carry a
 * partial frame across "reads" (a real XHR `responseText` grows byte-by-byte).
 */
function parseChunks(chunks: string[]): ChatSSEEvent[] {
  const frames = createFrameBuffer();
  const events: ChatSSEEvent[] = [];
  for (const chunk of chunks) {
    for (const event of frames.push(chunk)) events.push(event);
  }
  const tail = frames.flush();
  if (tail) events.push(tail);
  return events;
}

// -- Ported pure-parser fixtures --------------------------------------------
// These are byte-identical to the web `chat-stream.test.ts` fixtures. If the
// RN port diverges from web frame semantics, one of these fails.
describe("createFrameBuffer (ported pure parser)", () => {
  it("parses incremental token frames in order", () => {
    expect(
      parseChunks([
        'event: token\ndata: {"delta":"Hel"}\n\n',
        'event: token\ndata: {"delta":"lo"}\n\n',
      ]),
    ).toEqual([
      { type: "token", delta: "Hel" },
      { type: "token", delta: "lo" },
    ]);
  });

  it("buffers frames split across chunk boundaries", () => {
    expect(parseChunks(["event: to", 'ken\ndata: {"del', 'ta":"hi"}\n\n'])).toEqual([
      { type: "token", delta: "hi" },
    ]);
  });

  it("parses multiple frames arriving in a single chunk", () => {
    expect(
      parseChunks([
        'event: token\ndata: {"delta":"a"}\n\nevent: token\ndata: {"delta":"b"}\n\n',
      ]),
    ).toEqual([
      { type: "token", delta: "a" },
      { type: "token", delta: "b" },
    ]);
  });

  it("parses the terminal draft event with draftSpec + missingFields", () => {
    const events = parseChunks([
      'event: token\ndata: {"delta":"ok"}\n\n',
      'event: draft\ndata: {"draftSpec":{"goal":"hypertrophy","daysPerWeek":4},"missingFields":["location","sessionDurationMinutes","equipment","limitations"],"assistantMessage":"Done."}\n\n',
    ]);
    expect(events[0]).toEqual({ type: "token", delta: "ok" });
    expect(events[1]).toEqual({
      type: "draft",
      draftSpec: { goal: "hypertrophy", daysPerWeek: 4 },
      missingFields: ["location", "sessionDurationMinutes", "equipment", "limitations"],
      assistantMessage: "Done.",
    });
  });

  it("parses the terminal error event and maps `error` → reason", () => {
    expect(parseChunks(['event: error\ndata: {"error":"chat_stream_timeout"}\n\n'])).toEqual([
      { type: "error", reason: "chat_stream_timeout" },
    ]);
  });

  it("ignores malformed frames without a data line", () => {
    expect(
      parseChunks([": comment only\n\n", 'event: token\ndata: {"delta":"x"}\n\n']),
    ).toEqual([{ type: "token", delta: "x" }]);
  });

  it("ignores a frame whose data is not valid JSON", () => {
    expect(
      parseChunks(["event: token\ndata: not-json\n\n", 'event: token\ndata: {"delta":"ok"}\n\n']),
    ).toEqual([{ type: "token", delta: "ok" }]);
  });

  it("ignores a token frame whose delta is missing/not a string", () => {
    expect(
      parseChunks(['event: token\ndata: {"delta":123}\n\n', 'event: token\ndata: {"delta":"ok"}\n\n']),
    ).toEqual([{ type: "token", delta: "ok" }]);
  });

  it("defaults missingFields to [] when the draft frame's missingFields is not an array", () => {
    expect(
      parseChunks([
        'event: draft\ndata: {"draftSpec":{},"missingFields":"nope","assistantMessage":"ok"}\n\n',
      ]),
    ).toEqual([{ type: "draft", draftSpec: {}, missingFields: [], assistantMessage: "ok" }]);
  });

  it("ignores an unknown event name", () => {
    expect(
      parseChunks(['event: heartbeat\ndata: {}\n\n', 'event: token\ndata: {"delta":"x"}\n\n']),
    ).toEqual([{ type: "token", delta: "x" }]);
  });

  it("flushes a trailing frame that lacks a final blank line", () => {
    expect(parseChunks(['event: token\ndata: {"delta":"tail"}'])).toEqual([
      { type: "token", delta: "tail" },
    ]);
  });
});

// -- XHR-chunked SSE reader --------------------------------------------------

/** Deterministic, network-free stand-in for React Native's XMLHttpRequest. */
class MockXhr implements XhrLike {
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: string | undefined;
  responseText = "";
  readyState = 0;
  status = 0;
  timeout = 0;
  aborted = false;
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  send(body?: string): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
  }

  // --- test drivers ---
  /** Append a chunk to `responseText` and fire an `onprogress` (readyState 3). */
  emitProgress(chunk: string, status = 200): void {
    this.status = status;
    this.readyState = 3;
    this.responseText += chunk;
    this.onprogress?.();
  }

  /** Fire the terminal DONE (readyState 4). */
  emitDone(status = 200): void {
    this.status = status;
    this.readyState = 4;
    this.onreadystatechange?.();
  }

  emitError(): void {
    this.onerror?.();
  }

  /** Fire the XHR wall-clock timeout (half-open socket: no DONE, no error). */
  emitTimeout(): void {
    this.ontimeout?.();
  }
}

/** Flush the microtask + macrotask queue so the reader's `await getToken()` and
 * subsequent `xhr.send()` have run before the test drives the mock. */
const tick = () => new Promise((r) => setTimeout(r, 0));

const token = async () => "tok_abc";

describe("runChatStream (XHR-chunked SSE reader)", () => {
  it("POSTs /plan-specs/chat with a Bearer header and a JSON message body", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "hola",
      apiBaseUrl: "http://api.test",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("http://api.test/plan-specs/chat");
    expect(xhr.headers.authorization).toBe("Bearer tok_abc");
    expect(xhr.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(xhr.body ?? "{}")).toEqual({ message: "hola" });

    xhr.emitDone(200);
    await done;
  });

  it("emits ordered token deltas then the terminal draft as responseText grows", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      apiBaseUrl: "http://api.test",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    xhr.emitProgress('event: token\ndata: {"delta":"He"}\n\n');
    xhr.emitProgress('event: token\ndata: {"delta":"llo"}\n\n');
    xhr.emitProgress(
      'event: draft\ndata: {"draftSpec":{"goal":"strength"},"missingFields":[],"assistantMessage":"Listo."}\n\n',
    );
    xhr.emitDone(200);
    const result = await done;

    expect(events).toEqual([
      { type: "token", delta: "He" },
      { type: "token", delta: "llo" },
      {
        type: "draft",
        draftSpec: { goal: "strength" },
        missingFields: [],
        assistantMessage: "Listo.",
      },
    ]);
    expect(result).toEqual({ aborted: false, sessionExpired: false });
  });

  it("emits a frame that is split across two onprogress chunks", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    // First progress carries only the head of the frame → no event yet.
    xhr.emitProgress("event: token\ndata: {\"de");
    expect(events).toEqual([]);
    // Second progress completes the frame.
    xhr.emitProgress('lta":"split"}\n\n');
    xhr.emitDone(200);
    await done;

    expect(events).toEqual([{ type: "token", delta: "split" }]);
  });

  it("flushes a trailing frame lacking the final blank line on DONE", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    xhr.emitProgress('event: token\ndata: {"delta":"tail"}');
    xhr.emitDone(200);
    await done;

    expect(events).toEqual([{ type: "token", delta: "tail" }]);
  });

  it("surfaces a terminal error frame carried inside a 200 stream", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    xhr.emitProgress('event: error\ndata: {"error":"chat_stream_timeout"}\n\n');
    xhr.emitDone(200);
    const result = await done;

    expect(events).toEqual([{ type: "error", reason: "chat_stream_timeout" }]);
    expect(result).toEqual({ aborted: false, sessionExpired: false });
  });

  it("abort calls xhr.abort(), stops emitting, and resolves aborted", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const controller = new AbortController();
    const done = runChatStream({
      message: "m",
      getToken: token,
      signal: controller.signal,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    xhr.emitProgress('event: token\ndata: {"delta":"one"}\n\n');
    expect(events).toEqual([{ type: "token", delta: "one" }]);

    controller.abort();
    expect(xhr.aborted).toBe(true);

    // Any bytes arriving after the abort must NOT emit further events.
    xhr.emitProgress('event: token\ndata: {"delta":"two"}\n\n');
    const result = await done;

    expect(events).toEqual([{ type: "token", delta: "one" }]);
    expect(result).toEqual({ aborted: true, sessionExpired: false });
  });

  it("surfaces sessionExpired on a 401 without crashing", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    xhr.emitDone(401);
    const result = await done;

    expect(result).toEqual({ aborted: false, sessionExpired: true });
    expect(events).toEqual([{ type: "error", reason: "session_expired" }]);
  });

  it("maps a non-2xx (non-401) completion to a generic stream error", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    xhr.emitDone(500);
    const result = await done;

    expect(result).toEqual({ aborted: false, sessionExpired: false });
    expect(events).toEqual([{ type: "error", reason: "chat_stream_failed" }]);
  });

  it("maps a transport error (xhr.onerror) to a generic stream error", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      getToken: token,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();

    xhr.emitError();
    const result = await done;

    expect(result).toEqual({ aborted: false, sessionExpired: false });
    expect(events).toEqual([{ type: "error", reason: "chat_stream_failed" }]);
  });

  it("sets a default wall-clock timeout on the XHR", async () => {
    const xhr = new MockXhr();
    const done = runChatStream({
      message: "m",
      getToken: token,
      onEvent: () => {},
      xhrFactory: () => xhr,
    });
    await tick();
    expect(xhr.timeout).toBe(60_000);
    xhr.emitDone(200);
    await done;
  });

  it("settles once with a timeout error when the connection hangs (ontimeout), leaving the turn retry-able", async () => {
    const xhr = new MockXhr();
    const events: ChatSSEEvent[] = [];
    const done = runChatStream({
      message: "m",
      getToken: token,
      timeoutMs: 1234,
      onEvent: (e) => events.push(e),
      xhrFactory: () => xhr,
    });
    await tick();
    expect(xhr.timeout).toBe(1234);

    // A half-open socket: bytes never arrive, DONE/onerror never fire — only
    // the wall-clock timeout trips. Without this the Promise would hang forever
    // and the store's `streaming` guard would drop every future turn.
    xhr.emitTimeout();

    // A late DONE/progress arriving after the timeout must NOT double-settle or
    // double-emit.
    xhr.emitProgress('event: token\ndata: {"delta":"late"}\n\n');
    xhr.emitDone(200);
    const result = await done;

    expect(events).toEqual([{ type: "error", reason: "chat_stream_timeout" }]);
    expect(result).toEqual({ aborted: false, sessionExpired: false });
  });

  it("surfaces sessionExpired when no token is stored, without opening the XHR", async () => {
    const factory = vi.fn(() => new MockXhr());
    const events: ChatSSEEvent[] = [];
    const result = await runChatStream({
      message: "m",
      getToken: async () => null,
      onEvent: (e) => events.push(e),
      xhrFactory: factory,
    });

    expect(result).toEqual({ aborted: false, sessionExpired: true });
    expect(events).toEqual([{ type: "error", reason: "session_expired" }]);
    expect(factory).not.toHaveBeenCalled();
  });
});
