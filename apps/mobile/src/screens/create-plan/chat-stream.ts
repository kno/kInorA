import type { PlanSpecDraft } from "@kinora/contracts";
import type { ChatSSEEvent } from "./chat-types";

/**
 * RN SSE reader + pure frame parser for the Asistente chat stream (item-13 C2a).
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * The web app reads the `POST /plan-specs/chat` `text/event-stream` body with
 * `fetch` + `ReadableStream` (`apps/web/.../create-plan/chat-stream.ts`). React
 * Native's `fetch` (a whatwg-fetch polyfill over XHR) does NOT expose
 * `response.body` as a readable stream, and `EventSource` can neither POST nor
 * set an `Authorization` header — so the web reader cannot be reused directly.
 *
 * Instead we hand-roll a ~40-line XHR-progress chunked reader (the mechanism
 * `react-native-sse` implements) and feed the growing `xhr.responseText`
 * through the SAME pure frame parser ported VERBATIM from web. Hand-rolling
 * (rather than depending on `react-native-sse`) keeps the mobile dep surface
 * minimal AND keeps the parser OURS — the library ships its own EventSource
 * parser, which would duplicate/diverge from web frame semantics. See
 * `design.md` "RN SSE reader via react-native-sse-style XHR chunked reading".
 *
 * The pure `parseFrame` + `createFrameBuffer` below are byte-identical in
 * behavior to the web module (asserted against the same fixtures) so RN and web
 * share exactly one frame contract. No LLM/provider import.
 */

/**
 * Parse a single SSE frame into a typed event. Returns `null` for comment-only
 * or dataless frames (heartbeats / keep-alives), which the consumer skips.
 *
 * Ported verbatim from `apps/web/src/app/(app)/create-plan/chat-stream.ts`.
 */
export function parseFrame(frame: string): ChatSSEEvent | null {
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

/**
 * Stateful frame buffer: append raw text as it arrives (arbitrary chunk
 * boundaries) and receive the complete frames that became parseable. Mirrors
 * the web `parseSSEStream` inner loop exactly — `\n\n`-delimited frames, with a
 * partial trailing frame carried across pushes and flushed at end-of-stream.
 */
export function createFrameBuffer() {
  let buffer = "";
  return {
    /** Feed a chunk; returns every frame that completed within it, in order. */
    push(chunk: string): ChatSSEEvent[] {
      buffer += chunk;
      const events: ChatSSEEvent[] = [];
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseFrame(frame);
        if (event) events.push(event);
        boundary = buffer.indexOf("\n\n");
      }
      return events;
    },
    /** Flush a trailing frame that lacked a final blank line, then reset. */
    flush(): ChatSSEEvent | null {
      const tail = parseFrame(buffer);
      buffer = "";
      return tail;
    },
  };
}

/**
 * Minimal XHR surface this reader uses. Kept structural (not `XMLHttpRequest`)
 * so the reader is unit-testable with a mock in vitest and does not depend on
 * RN's ambient DOM lib typings.
 */
export interface XhrLike {
  responseText: string;
  readyState: number;
  status: number;
  /** Wall-clock timeout in ms; `0` disables. Fires `ontimeout` when exceeded. */
  timeout: number;
  onreadystatechange: (() => void) | null;
  onprogress: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: string): void;
  abort(): void;
}

export interface ChatStreamOptions {
  /** The user message to send as the turn body. */
  message: string;
  /** API origin; defaults to `process.env.API_BASE_URL` then localhost. */
  apiBaseUrl?: string;
  /** Bearer token source; defaults to Expo SecureStore. */
  getToken?: () => Promise<string | null>;
  /** Abort the in-flight turn (unmount/navigation). */
  signal?: AbortSignal;
  /**
   * Wall-clock timeout in ms for a hung/half-open connection (socket accepted,
   * no bytes, never closes). Defaults to {@link DEFAULT_TIMEOUT_MS}, aligned
   * with the API's server-side chat-stream timeout so the client does not give
   * up before the server does.
   */
  timeoutMs?: number;
  /** Called with each parsed SSE event (token / draft / error) in order. */
  onEvent: (event: ChatSSEEvent) => void;
  /** XHR factory — overridable for tests. */
  xhrFactory?: () => XhrLike;
}

export interface ChatStreamResult {
  /** True when the caller aborted before completion. */
  aborted: boolean;
  /** True on a `401` (or missing token) — the re-auth/logout signal (C1). */
  sessionExpired: boolean;
}

const DEFAULT_API_BASE_URL = "http://localhost:4000";

/**
 * Default XHR wall-clock timeout (ms). A hung/half-open mobile connection never
 * reaches readyState 4 and never fires `onerror`, so WITHOUT a timeout the
 * Promise would never settle — the store's `streaming` guard would then wedge
 * and silently drop every future turn (stuck spinner). 60s is aligned with the
 * API's server-side chat-stream timeout so the client never gives up first.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Default token source. Imported lazily so this module's graph does not pull in
 * `expo-secure-store` at import time — keeps the reader unit-testable under
 * vitest (a `getToken` override is always injected). Mirrors
 * `plan-draft-client.ts` / `workout-session.ts`.
 */
async function defaultGetToken(): Promise<string | null> {
  const { getSessionToken } = await import("../../auth/session-storage");
  return getSessionToken();
}

/**
 * Stream one chat turn over an XHR-progress chunked reader.
 *
 * POSTs `{ message }` to `${base}/plan-specs/chat` with an `Authorization:
 * Bearer <token>` header (mobile calls the API DIRECTLY — no same-origin proxy,
 * unlike web). As `xhr.responseText` grows on each `onprogress`/readyState-3
 * event, the newly appended bytes are fed through the ported frame buffer and
 * every completed frame is emitted via `onEvent`. On DONE the trailing partial
 * frame is flushed.
 *
 * Terminal outcomes:
 *   - 200 stream → `token`* then a terminal `draft` or `error` frame (parser).
 *   - 401        → emits `{ type: "error", reason: "session_expired" }` and
 *                  resolves `{ sessionExpired: true }`.
 *   - other non-2xx / transport error → `{ type: "error", reason:
 *                  "chat_stream_failed" }`.
 *   - abort      → resolves `{ aborted: true }`, emitting nothing further.
 *
 * The returned promise settles exactly once.
 */
export function runChatStream(options: ChatStreamOptions): Promise<ChatStreamResult> {
  const {
    message,
    apiBaseUrl,
    signal,
    onEvent,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    getToken = defaultGetToken,
    xhrFactory = () => new XMLHttpRequest() as unknown as XhrLike,
  } = options;

  return new Promise<ChatStreamResult>((resolve) => {
    let settled = false;
    const settle = (result: ChatStreamResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    void (async () => {
      const token = await getToken();
      if (!token) {
        // No stored session — treat as a re-auth signal without opening a socket.
        onEvent({ type: "error", reason: "session_expired" });
        settle({ aborted: false, sessionExpired: true });
        return;
      }
      if (signal?.aborted) {
        settle({ aborted: true, sessionExpired: false });
        return;
      }

      const base = apiBaseUrl ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
      const xhr = xhrFactory();
      const frames = createFrameBuffer();
      let consumed = 0;
      let aborted = false;
      let finished = false;

      const onAbort = () => {
        if (finished) return;
        finished = true;
        aborted = true;
        try {
          xhr.abort();
        } catch {
          // ignore — best-effort teardown
        }
        signal?.removeEventListener("abort", onAbort);
        settle({ aborted: true, sessionExpired: false });
      };
      signal?.addEventListener("abort", onAbort);

      // Consume any newly-arrived responseText bytes (idempotent via `consumed`
      // offset, so onprogress + readyState-3 double-firing never double-emits).
      //
      // No TextDecoder is needed here (unlike the web reader, which decodes raw
      // Uint8Array chunks with `TextDecoder({ stream: true })`): XHR
      // `responseText` is ALREADY incrementally/stream-decoded by the platform —
      // an incomplete trailing multibyte UTF-8 sequence is held back internally,
      // not surfaced as a partial char / U+FFFD. Combined with only ever slicing
      // at `responseText.length` and emitting on complete `\n\n` boundaries, a
      // code point can never be split. (D real-device smoke should still confirm
      // Spanish accented tokens — í/ñ/á — render correctly against the real API.)
      const pump = () => {
        if (aborted || finished) return;
        if (xhr.status !== 200) return;
        const text = xhr.responseText;
        if (text.length <= consumed) return;
        const delta = text.slice(consumed);
        consumed = text.length;
        for (const event of frames.push(delta)) onEvent(event);
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);

        if (xhr.status === 200) {
          pump();
          const tail = frames.flush();
          if (tail) onEvent(tail);
          settle({ aborted: false, sessionExpired: false });
          return;
        }
        if (xhr.status === 401) {
          onEvent({ type: "error", reason: "session_expired" });
          settle({ aborted: false, sessionExpired: true });
          return;
        }
        onEvent({ type: "error", reason: "chat_stream_failed" });
        settle({ aborted: false, sessionExpired: false });
      };

      xhr.onprogress = pump;
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3) pump();
        else if (xhr.readyState === 4) finish();
      };
      xhr.onerror = () => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        onEvent({ type: "error", reason: "chat_stream_failed" });
        settle({ aborted: false, sessionExpired: false });
      };

      // Half-open connection: no bytes, no DONE, no onerror. Without this the
      // Promise never settles and the store's `streaming` guard wedges forever.
      // Settle exactly once with a retry-able terminal error.
      xhr.ontimeout = () => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        onEvent({ type: "error", reason: "chat_stream_timeout" });
        settle({ aborted: false, sessionExpired: false });
      };

      xhr.open("POST", `${base}/plan-specs/chat`);
      // `timeout` must be set AFTER open() per the XHR spec.
      xhr.timeout = timeoutMs;
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader("content-type", "application/json");
      xhr.send(JSON.stringify({ message }));
    })();
  });
}
