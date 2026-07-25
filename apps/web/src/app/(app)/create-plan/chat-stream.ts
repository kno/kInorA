import type { PlanSpecDraft } from "@kinora/contracts";
import type { ChatSSEEvent } from "./chat-types";

/**
 * Pure SSE frame parser for the Asistente chat stream (12 Slice 3).
 *
 * Consumes a `ReadableStream<Uint8Array>` (the `Response.body` from a POST to
 * the same-origin `/create-plan/chat` proxy) and yields typed `ChatSSEEvent`s
 * as complete frames arrive. Frames are `event: <name>\ndata: <json>\n\n`;
 * the parser buffers partial reads so a frame split across TCP chunks is only
 * emitted once fully received.
 *
 * No LLM/provider import — the browser renders parsed frames only.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatSSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }

    // Flush a trailing frame that lacked a final blank line.
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parse a single SSE frame into a typed event. Returns `null` for comment-only
 * or dataless frames (heartbeats / keep-alives), which the consumer skips.
 */
function parseFrame(frame: string): ChatSSEEvent | null {
  let eventName: string | null = null;
  let data: string | null = null;

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      const chunk = line.slice("data:".length).trim();
      data = data === null ? chunk : `${data}\n${chunk}`;
    }
  }

  if (eventName === null || data === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  const record = (payload ?? {}) as Record<string, unknown>;

  switch (eventName) {
    case "token":
      return typeof record.delta === "string"
        ? { type: "token", delta: record.delta }
        : null;
    case "draft":
      return {
        type: "draft",
        draftSpec: (record.draftSpec ?? {}) as PlanSpecDraft,
        missingFields: Array.isArray(record.missingFields)
          ? (record.missingFields as string[])
          : [],
        assistantMessage:
          typeof record.assistantMessage === "string" ? record.assistantMessage : "",
      };
    case "error":
      return {
        type: "error",
        reason: typeof record.error === "string" ? record.error : "generic",
      };
    default:
      return null;
  }
}
