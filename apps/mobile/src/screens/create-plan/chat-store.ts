import {
  runChatStream,
  type ChatStreamOptions,
  type ChatStreamResult,
} from "./chat-stream";
import type { ChatDraftSpec } from "./chat-types";

/**
 * Headless turn-lifecycle store for the RN Asistente chat (item-13 C2a).
 *
 * This is the transport + state layer ONLY — no React Native screen/JSX. It
 * mirrors the web `AssistantPane` turn logic (`apps/web/.../AssistantPane.tsx`)
 * so the mobile Asistente (C2b) renders identical behavior:
 *   - `runTurn` appends a user bubble + an empty assistant placeholder, streams
 *     `token` deltas into that placeholder, applies the terminal `draft` to the
 *     shared extracted-spec state, and on a terminal `error` records the reason
 *     while preserving the prior draft (and any partial prose already streamed);
 *   - turns are SERIALIZED — a new turn cannot start while one is in flight
 *     (the S2b lost-update mitigation);
 *   - `dispose` aborts the in-flight turn (unmount/navigation) and freezes state
 *     so a late stream callback never mutates a torn-down store;
 *   - a `401`/missing-token stream surfaces the same session-expiry signal C1
 *     established (`onSessionExpired`), for the caller to clear the token and
 *     route to Login.
 *
 * It is framework-agnostic (a `getState`/`subscribe` observable) so it can be
 * unit-tested deterministically and consumed by a C2b screen via
 * `useSyncExternalStore` (or a thin `useChatStore` hook).
 */

export interface ChatMessage {
  role: "assistant" | "user";
  text: string;
}

export interface ChatState {
  messages: ChatMessage[];
  spec: ChatDraftSpec;
  streaming: boolean;
  errorReason: string | null;
  sessionExpired: boolean;
}

export interface ChatStore {
  getState(): ChatState;
  subscribe(listener: () => void): () => void;
  /** Run one turn. `appendUserMessage` is false on retry (reuse the last bubble). */
  runTurn(message: string, appendUserMessage?: boolean): Promise<void>;
  /** Re-run the last turn without appending a duplicate user bubble. */
  retry(): Promise<void>;
  /** Apply a panel edit to the shared draft (C2b "Datos extraídos"). */
  setSpec(spec: ChatDraftSpec): void;
  /** Swap the stream implementation (used to retarget a retry). */
  setStream(stream: ChatStreamFn): void;
  /** Abort any in-flight turn and freeze the store (teardown). */
  dispose(): void;
}

export type ChatStreamFn = (options: ChatStreamOptions) => Promise<ChatStreamResult>;

export interface CreateChatStoreOptions {
  /** Seed assistant greeting bubble. */
  greeting?: string;
  /** Initial shared draft (e.g. a server-loaded current draft). */
  initialSpec?: ChatDraftSpec;
  /** Stream implementation — overridable for tests. */
  stream?: ChatStreamFn;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
  /** Invoked once when a turn surfaces a session-expiry (401/missing token). */
  onSessionExpired?: () => void;
}

export function createChatStore(options: CreateChatStoreOptions = {}): ChatStore {
  const { greeting, initialSpec, apiBaseUrl, getToken, onSessionExpired } = options;
  let stream: ChatStreamFn = options.stream ?? runChatStream;

  let state: ChatState = {
    messages: greeting ? [{ role: "assistant", text: greeting }] : [],
    spec: initialSpec ?? {},
    streaming: false,
    errorReason: null,
    sessionExpired: false,
  };

  const listeners = new Set<() => void>();
  let disposed = false;
  let controller: AbortController | null = null;
  let lastUserMessage = "";

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** Merge a state patch and notify — a no-op once disposed (state frozen). */
  const setState = (patch: Partial<ChatState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    emit();
  };

  const runTurn = async (message: string, appendUserMessage = true): Promise<void> => {
    // Turn serialization: never overlap turns (prevents the shared-draft
    // lost-update from two concurrent commits).
    if (state.streaming || disposed) return;

    lastUserMessage = message;
    const withUser = appendUserMessage
      ? [...state.messages, { role: "user" as const, text: message }]
      : state.messages;
    setState({
      errorReason: null,
      streaming: true,
      messages: [...withUser, { role: "assistant" as const, text: "" }],
    });

    controller = new AbortController();

    const result = await stream({
      message,
      apiBaseUrl,
      getToken,
      signal: controller.signal,
      onEvent: (event) => {
        if (disposed) return;
        if (event.type === "token") {
          setState({ messages: appendToAssistant(state.messages, event.delta) });
        } else if (event.type === "draft") {
          if (event.assistantMessage) {
            setState({ messages: replaceAssistant(state.messages, event.assistantMessage) });
          }
          // Terminal draft commits the extracted spec exactly once.
          setState({ spec: event.draftSpec });
        } else {
          // Terminal error: drop a still-empty assistant placeholder (no blank
          // bubble); keep it when partial prose already streamed. The prior
          // draft is left untouched.
          setState({
            messages: removeTrailingEmptyAssistant(state.messages),
            errorReason: event.reason,
          });
        }
      },
    });

    if (result.sessionExpired) {
      setState({ sessionExpired: true });
      onSessionExpired?.();
    }
    // An aborted turn leaves `streaming` frozen — the store is being torn down.
    if (!result.aborted) setState({ streaming: false });
  };

  const retry = () => {
    if (lastUserMessage === "") return Promise.resolve();
    return runTurn(lastUserMessage, false);
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    runTurn,
    retry,
    setSpec(spec) {
      setState({ spec });
    },
    setStream(next) {
      stream = next;
    },
    dispose() {
      controller?.abort();
      disposed = true;
      listeners.clear();
    },
  };
}

function appendToAssistant(messages: ChatMessage[], delta: string): ChatMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]!.role === "assistant") {
      next[i] = { role: "assistant", text: next[i]!.text + delta };
      return next;
    }
  }
  return next;
}

/**
 * Drop the trailing assistant placeholder when it is still empty (no prose
 * arrived before a terminal error) so the thread never renders a blank coach
 * bubble. A placeholder that already received partial prose is left in place as
 * the (incomplete) reply.
 */
function removeTrailingEmptyAssistant(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.text === "") {
    return messages.slice(0, -1);
  }
  return messages;
}

function replaceAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]!.role === "assistant") {
      next[i] = { role: "assistant", text };
      return next;
    }
  }
  return next;
}
