import { describe, expect, it } from "vitest";
import { parseSSEStream } from "../chat-stream";
import type { ChatSSEEvent } from "../chat-types";

/**
 * Build a ReadableStream<Uint8Array> that emits the given chunks in order.
 * Chunk boundaries are intentionally arbitrary so the parser must buffer
 * across reads (a real socket splits frames anywhere).
 */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatSSEEvent[]> {
  const events: ChatSSEEvent[] = [];
  for await (const evt of parseSSEStream(stream)) {
    events.push(evt);
  }
  return events;
}

describe("parseSSEStream", () => {
  it("parses incremental token frames in order", async () => {
    const events = await collect(
      streamOf([
        'event: token\ndata: {"delta":"Hel"}\n\n',
        'event: token\ndata: {"delta":"lo"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { type: "token", delta: "Hel" },
      { type: "token", delta: "lo" },
    ]);
  });

  it("buffers frames split across chunk boundaries", async () => {
    // A single frame arrives in three arbitrary pieces.
    const events = await collect(
      streamOf(["event: to", 'ken\ndata: {"del', 'ta":"hi"}\n\n']),
    );
    expect(events).toEqual([{ type: "token", delta: "hi" }]);
  });

  it("parses the terminal draft event with draftSpec + missingFields", async () => {
    const events = await collect(
      streamOf([
        'event: token\ndata: {"delta":"ok"}\n\n',
        'event: draft\ndata: {"draftSpec":{"goal":"hypertrophy","daysPerWeek":4},"missingFields":["location","sessionDurationMinutes","equipment","limitations"],"assistantMessage":"Done."}\n\n',
      ]),
    );
    expect(events[0]).toEqual({ type: "token", delta: "ok" });
    expect(events[1]).toEqual({
      type: "draft",
      draftSpec: { goal: "hypertrophy", daysPerWeek: 4 },
      missingFields: ["location", "sessionDurationMinutes", "equipment", "limitations"],
      assistantMessage: "Done.",
    });
  });

  it("parses the terminal error event and maps `error` → reason", async () => {
    const events = await collect(
      streamOf(['event: error\ndata: {"error":"chat_stream_timeout"}\n\n']),
    );
    expect(events).toEqual([{ type: "error", reason: "chat_stream_timeout" }]);
  });

  it("ignores malformed frames without a data line", async () => {
    const events = await collect(
      streamOf([": comment only\n\n", 'event: token\ndata: {"delta":"x"}\n\n']),
    );
    expect(events).toEqual([{ type: "token", delta: "x" }]);
  });

  it("ignores a frame whose data is not valid JSON", async () => {
    const events = await collect(
      streamOf(["event: token\ndata: not-json\n\n", 'event: token\ndata: {"delta":"ok"}\n\n']),
    );
    expect(events).toEqual([{ type: "token", delta: "ok" }]);
  });

  it("ignores a token frame whose delta is missing/not a string", async () => {
    const events = await collect(
      streamOf(['event: token\ndata: {"delta":123}\n\n', 'event: token\ndata: {"delta":"ok"}\n\n']),
    );
    expect(events).toEqual([{ type: "token", delta: "ok" }]);
  });

  it("defaults missingFields to [] when the draft frame's missingFields is not an array", async () => {
    const events = await collect(
      streamOf([
        'event: draft\ndata: {"draftSpec":{},"missingFields":"nope","assistantMessage":"ok"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { type: "draft", draftSpec: {}, missingFields: [], assistantMessage: "ok" },
    ]);
  });

  it("ignores an unknown event name", async () => {
    const events = await collect(
      streamOf(['event: heartbeat\ndata: {}\n\n', 'event: token\ndata: {"delta":"x"}\n\n']),
    );
    expect(events).toEqual([{ type: "token", delta: "x" }]);
  });

  it("flushes a trailing frame that lacks a final blank line", async () => {
    const events = await collect(streamOf(['event: token\ndata: {"delta":"tail"}']));
    expect(events).toEqual([{ type: "token", delta: "tail" }]);
  });
});
