import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../chat-store";
import type { ChatStreamOptions, ChatStreamResult } from "../chat-stream";
import type { ChatSSEEvent } from "../chat-types";

/**
 * A scripted `runChatStream` stand-in: emits the given events in order (via the
 * store's `onEvent`) and resolves with the given result. Captures the options
 * the store passed (signal, message) so the test can assert turn wiring without
 * a real XHR.
 */
function scriptedStream(
  events: ChatSSEEvent[],
  result: ChatStreamResult = { aborted: false, sessionExpired: false },
) {
  const calls: ChatStreamOptions[] = [];
  const fn = vi.fn((options: ChatStreamOptions): Promise<ChatStreamResult> => {
    calls.push(options);
    for (const event of events) options.onEvent(event);
    return Promise.resolve(result);
  });
  return { fn, calls };
}

/** A stream that never resolves until `finish` is called — models an in-flight
 * turn so serialization / abort can be asserted deterministically. */
function pendingStream() {
  let resolveFn: (r: ChatStreamResult) => void = () => {};
  let captured: ChatStreamOptions | null = null;
  const fn = vi.fn((options: ChatStreamOptions): Promise<ChatStreamResult> => {
    captured = options;
    return new Promise<ChatStreamResult>((resolve) => {
      resolveFn = resolve;
    });
  });
  return {
    fn,
    get options() {
      return captured;
    },
    finish: (r: ChatStreamResult = { aborted: false, sessionExpired: false }) =>
      resolveFn(r),
  };
}

describe("createChatStore", () => {
  it("seeds the thread with the greeting and the initial spec", () => {
    const store = createChatStore({
      greeting: "¡Hola!",
      initialSpec: { goal: "strength" },
      stream: scriptedStream([]).fn,
    });
    const state = store.getState();
    expect(state.messages).toEqual([{ role: "assistant", text: "¡Hola!" }]);
    expect(state.spec).toEqual({ goal: "strength" });
    expect(state.streaming).toBe(false);
    expect(state.errorReason).toBeNull();
    expect(state.sessionExpired).toBe(false);
  });

  it("streams tokens into the assistant bubble then commits the draft exactly once", async () => {
    const setSpec = vi.fn();
    const { fn } = scriptedStream([
      { type: "token", delta: "He" },
      { type: "token", delta: "llo" },
      {
        type: "draft",
        draftSpec: { goal: "hypertrophy", daysPerWeek: 4 },
        missingFields: ["location"],
        assistantMessage: "Ajustado.",
      },
    ]);
    const store = createChatStore({ greeting: "hi", stream: fn });

    await store.runTurn("quiero fuerza");

    const state = store.getState();
    // user bubble + one assistant bubble carrying the terminal assistantMessage
    expect(state.messages).toEqual([
      { role: "assistant", text: "hi" },
      { role: "user", text: "quiero fuerza" },
      { role: "assistant", text: "Ajustado." },
    ]);
    // Draft committed once, to the extracted spec.
    expect(state.spec).toEqual({ goal: "hypertrophy", daysPerWeek: 4 });
    expect(state.streaming).toBe(false);
    expect(state.errorReason).toBeNull();
  });

  it("keeps the streamed prose when the draft carries no assistantMessage", async () => {
    const { fn } = scriptedStream([
      { type: "token", delta: "streamed" },
      {
        type: "draft",
        draftSpec: { goal: "strength" },
        missingFields: [],
        assistantMessage: "",
      },
    ]);
    const store = createChatStore({ greeting: "hi", stream: fn });
    await store.runTurn("m");
    const last = store.getState().messages.at(-1);
    expect(last).toEqual({ role: "assistant", text: "streamed" });
  });

  it("passes the typed message to the stream and forwards an AbortSignal", async () => {
    const { fn, calls } = scriptedStream([]);
    const store = createChatStore({ greeting: "hi", stream: fn });
    await store.runTurn("hola coach");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.message).toBe("hola coach");
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("ignores an empty/whitespace-only message: no bubble, no stream", async () => {
    const { fn } = scriptedStream([]);
    const store = createChatStore({ greeting: "hi", stream: fn });
    await store.runTurn("   ");
    await store.runTurn("");
    expect(fn).not.toHaveBeenCalled();
    expect(store.getState().messages).toEqual([{ role: "assistant", text: "hi" }]);
    expect(store.getState().streaming).toBe(false);
  });

  it("leaves the turn retry-able after a timeout error (streaming clears, next turn runs)", async () => {
    const first = scriptedStream([{ type: "error", reason: "chat_stream_timeout" }]);
    const store = createChatStore({ greeting: "hi", stream: first.fn });
    await store.runTurn("uno");
    // Timeout must NOT wedge the store: streaming cleared, error recorded.
    expect(store.getState().streaming).toBe(false);
    expect(store.getState().errorReason).toBe("chat_stream_timeout");

    // A subsequent turn is NOT blocked by a stuck `streaming` guard.
    const second = scriptedStream([{ type: "token", delta: "ok" }]);
    store.setStream(second.fn);
    await store.runTurn("dos");
    expect(second.fn).toHaveBeenCalledTimes(1);
    expect(store.getState().messages.at(-1)).toEqual({ role: "assistant", text: "ok" });
  });

  it("serializes turns: a second runTurn is ignored while one is in flight", async () => {
    const pending = pendingStream();
    const store = createChatStore({ greeting: "hi", stream: pending.fn });

    const first = store.runTurn("uno");
    expect(store.getState().streaming).toBe(true);

    // Second call while streaming → no new stream started.
    await store.runTurn("dos");
    expect(pending.fn).toHaveBeenCalledTimes(1);
    // The "dos" bubble was never appended.
    expect(store.getState().messages.map((m) => m.text)).toEqual(["hi", "uno", ""]);

    pending.finish();
    await first;
    expect(store.getState().streaming).toBe(false);
  });

  it("dispose aborts the in-flight turn and drops later state updates", async () => {
    const pending = pendingStream();
    const store = createChatStore({ greeting: "hi", stream: pending.fn });

    const turn = store.runTurn("uno");
    const signal = pending.options!.signal!;
    expect(signal.aborted).toBe(false);

    store.dispose();
    expect(signal.aborted).toBe(true);

    // Resolve the (aborted) stream: no state mutation should land post-dispose.
    pending.finish({ aborted: true, sessionExpired: false });
    await turn;
    // streaming flag frozen at teardown — no update applied after dispose.
    expect(store.getState().streaming).toBe(true);
  });

  it("on a terminal error, drops the empty assistant bubble and records the reason", async () => {
    const { fn } = scriptedStream([{ type: "error", reason: "chat_stream_timeout" }]);
    const store = createChatStore({ greeting: "hi", stream: fn });
    await store.runTurn("m");
    const state = store.getState();
    expect(state.errorReason).toBe("chat_stream_timeout");
    // Empty trailing assistant placeholder removed; user bubble preserved.
    expect(state.messages).toEqual([
      { role: "assistant", text: "hi" },
      { role: "user", text: "m" },
    ]);
  });

  it("a terminal error after partial prose keeps the partial reply and the prior draft", async () => {
    const { fn } = scriptedStream([
      { type: "token", delta: "partial" },
      { type: "error", reason: "chat_stream_failed" },
    ]);
    const store = createChatStore({
      greeting: "hi",
      initialSpec: { goal: "strength" },
      stream: fn,
    });
    await store.runTurn("m");
    const state = store.getState();
    expect(state.errorReason).toBe("chat_stream_failed");
    expect(state.messages.at(-1)).toEqual({ role: "assistant", text: "partial" });
    // Prior draft preserved across the error.
    expect(state.spec).toEqual({ goal: "strength" });
  });

  it("retry re-runs the last turn without appending a duplicate user bubble", async () => {
    const first = scriptedStream([{ type: "error", reason: "chat_stream_failed" }]);
    const store = createChatStore({ greeting: "hi", stream: first.fn });
    await store.runTurn("intenta");
    expect(store.getState().messages.map((m) => m.role)).toEqual(["assistant", "user"]);

    // Swap in a successful stream for the retry.
    const retryStream = scriptedStream([
      {
        type: "draft",
        draftSpec: { goal: "strength" },
        missingFields: [],
        assistantMessage: "Ok.",
      },
    ]);
    store.setStream(retryStream.fn);
    await store.retry();

    const roles = store.getState().messages.map((m) => m.role);
    // No second user bubble — one user message, one (final) assistant reply.
    expect(roles).toEqual(["assistant", "user", "assistant"]);
    expect(store.getState().errorReason).toBeNull();
  });

  it("surfaces sessionExpired and invokes the onSessionExpired callback on a 401 stream", async () => {
    const onSessionExpired = vi.fn();
    const { fn } = scriptedStream(
      [{ type: "error", reason: "session_expired" }],
      { aborted: false, sessionExpired: true },
    );
    const store = createChatStore({ greeting: "hi", stream: fn, onSessionExpired });
    await store.runTurn("m");
    expect(store.getState().sessionExpired).toBe(true);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers on state changes", async () => {
    const { fn } = scriptedStream([{ type: "token", delta: "x" }]);
    const store = createChatStore({ greeting: "hi", stream: fn });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    await store.runTurn("m");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    const before = listener.mock.calls.length;
    store.setSpec({ goal: "strength" });
    expect(listener.mock.calls.length).toBe(before);
  });

  it("setSpec updates the shared draft (panel edits) and notifies", () => {
    const store = createChatStore({ greeting: "hi", stream: scriptedStream([]).fn });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSpec({ goal: "fat_loss", daysPerWeek: 3 });
    expect(store.getState().spec).toEqual({ goal: "fat_loss", daysPerWeek: 3 });
    expect(listener).toHaveBeenCalled();
  });
});
