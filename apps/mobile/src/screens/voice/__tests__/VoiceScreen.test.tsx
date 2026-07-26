import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../../i18n/locale.js";
import type { ChatStreamOptions, ChatStreamResult } from "../../create-plan/chat-stream";
import type { ChatSSEEvent } from "../../create-plan/chat-types";
import type { VoiceRecorder } from "../../../audio/recorder";
import type { TranscribeAudio, TranscribeOutcome } from "../../../api/transcribe-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Stub react-native with passthrough host elements (same constraint as
// AssistantScreen.test / HomeScreen.test — Vite cannot parse RN's Flow entry).
// Pressable forwards ALL props so the suite can invoke onPressIn/onPressOut
// (push-to-talk) and read `disabled` directly.
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  TextInput: (props: any) => <input {...props} />,
  Pressable: (props: any) => <button type="button" {...props} />,
  StyleSheet: { create: (styles: unknown) => styles },
}));

// The screen imports `deleteSessionToken` at module scope → expo-secure-store →
// expo-modules-core (reads RN `__DEV__` at import). Stub it (and inject
// `clearSession`) so the module graph stays test-safe.
vi.mock("../../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(async () => {}),
}));

const VoiceScreen = (await import("../VoiceScreen.js")).default;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeRecorder(overrides: Partial<VoiceRecorder> = {}): VoiceRecorder {
  return {
    requestPermission: vi.fn(async () => "granted" as const),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({
      uri: "file:///a.m4a",
      contentType: "audio/m4a",
      fileName: "audio.m4a",
    })),
    release: vi.fn(() => {}),
    ...overrides,
  };
}

/** A scripted chat stream (emits events, resolves). */
function scriptedStream(
  events: ChatSSEEvent[],
  result: ChatStreamResult = { aborted: false, sessionExpired: false },
) {
  const fn = vi.fn((options: ChatStreamOptions): Promise<ChatStreamResult> => {
    for (const event of events) options.onEvent(event);
    return Promise.resolve(result);
  });
  return fn;
}

/** A chat stream that stays in flight until `finish` is called. */
function pendingStream() {
  let resolveFn: (r: ChatStreamResult) => void = () => {};
  const fn = vi.fn(
    (): Promise<ChatStreamResult> =>
      new Promise<ChatStreamResult>((resolve) => {
        resolveFn = resolve;
      }),
  );
  return { fn, finish: (r: ChatStreamResult = { aborted: false, sessionExpired: false }) => resolveFn(r) };
}

function renderScreen(props: Record<string, unknown> = {}) {
  const navigation = {
    navigate: vi.fn(),
    reset: vi.fn(),
    replace: vi.fn(),
    goBack: vi.fn(),
  } as any;
  const clearSession = vi.fn(async () => {});
  let subscribeConnectivity: ((cb: (online: boolean) => void) => () => void) | undefined;
  let connectivityCb: ((online: boolean) => void) | null = null;
  if (!("subscribeConnectivity" in props)) {
    subscribeConnectivity = (cb) => {
      connectivityCb = cb;
      return () => {};
    };
  }
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" defaultLocale="en" messages={resolveMessages("en")}>
        <VoiceScreen
          navigation={navigation}
          clearSession={clearSession}
          subscribeConnectivity={subscribeConnectivity}
          {...props}
        />
      </IntlProvider>,
    );
  });
  return {
    renderer,
    navigation,
    clearSession,
    setConnectivity: (online: boolean) => connectivityCb?.(online),
  };
}

const status = (r: ReactTestRenderer) =>
  r.root.find((n) => n.props.testID === "voice-status").props.children as string;
const mic = (r: ReactTestRenderer) => r.root.find((n) => n.props.testID === "mic-btn");
const bubbleTexts = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.props.testID === "voice-bubble").map((n) => n.props.children as string);

describe("VoiceScreen (D1 Expo mic → transcribe → shared chat turn)", () => {
  it("runs the orb state machine idle → listening → processing → responding → idle", async () => {
    const recorder = fakeRecorder();
    const tx = deferred<TranscribeOutcome>();
    const transcribe = vi.fn(() => tx.promise);
    const stream = pendingStream();
    const { renderer } = renderScreen({ recorder, transcribe, stream: stream.fn });
    await act(async () => {}); // flush the mount permission request

    expect(status(renderer)).toBe("Ready");

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    expect(status(renderer)).toBe("Listening…");

    // Release → processing while the transcribe is still pending.
    act(() => {
      void mic(renderer).props.onPressOut();
    });
    await act(async () => {}); // flush recorder.stop()
    expect(status(renderer)).toBe("Processing…");

    // Transcript resolves → the shared turn starts and stays streaming.
    await act(async () => {
      tx.resolve({ kind: "ok", text: "quiero fuerza", unclear: false });
    });
    expect(status(renderer)).toBe("kInorA is responding…");

    // Stream completes → back to idle.
    await act(async () => {
      stream.finish();
    });
    expect(status(renderer)).toBe("Ready");
  });

  it("feeds a successful transcript into the shared runTurn (direct transcribe, Bearer-based)", async () => {
    const recorder = fakeRecorder();
    const transcribe = vi.fn(
      async (
        _audio: TranscribeAudio,
        _opts: { signal?: AbortSignal },
      ): Promise<TranscribeOutcome> => ({ kind: "ok", text: "arma mi plan", unclear: false }),
    );
    const stream = scriptedStream([
      { type: "draft", draftSpec: { goal: "strength" }, missingFields: [], assistantMessage: "Ok." },
    ]);
    const { renderer } = renderScreen({ recorder, transcribe, stream });
    await act(async () => {});

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    await act(async () => {
      await mic(renderer).props.onPressOut();
    });

    // The recorded file was uploaded directly (with an abort signal).
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![0]).toEqual({
      uri: "file:///a.m4a",
      contentType: "audio/m4a",
      fileName: "audio.m4a",
    });
    expect(transcribe.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    // The transcript ran through the SAME chat turn as a typed message.
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]![0].message).toBe("arma mi plan");
    expect(bubbleTexts(renderer)).toContain("arma mi plan");
  });

  it("re-prompts on an unclear/empty transcript and never starts a chat turn", async () => {
    const recorder = fakeRecorder();
    const transcribe = vi.fn(async (): Promise<TranscribeOutcome> => ({ kind: "ok", text: "", unclear: true }));
    const stream = scriptedStream([]);
    const { renderer } = renderScreen({ recorder, transcribe, stream });
    await act(async () => {});

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    await act(async () => {
      await mic(renderer).props.onPressOut();
    });

    const notice = renderer.root.find((n) => n.props.testID === "voice-notice");
    expect(notice.props.children).toBe("I didn't catch that. Please try again.");
    expect(stream).not.toHaveBeenCalled();
    expect(status(renderer)).toBe("Ready");
  });

  it("mic permission denied disables the mic and keeps the text chat usable", async () => {
    const recorder = fakeRecorder({ requestPermission: vi.fn(async () => "denied" as const) });
    const stream = scriptedStream([
      { type: "draft", draftSpec: {}, missingFields: [], assistantMessage: "Hola." },
    ]);
    const { renderer } = renderScreen({ recorder, stream });
    await act(async () => {}); // flush the denied permission

    expect(mic(renderer).props.disabled).toBe(true);
    const notice = renderer.root.find((n) => n.props.testID === "voice-notice");
    expect(notice.props.children).toBe("Microphone access is required for voice. You can keep typing.");

    // The inline text composer still drives the shared chat turn.
    const input = renderer.root.find((n) => n.props.testID === "voice-text-input");
    act(() => input.props.onChangeText("escribo en su lugar"));
    const send = renderer.root.find((n) => n.props.testID === "voice-send-btn");
    await act(async () => {
      await send.props.onPress();
    });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(bubbleTexts(renderer)).toContain("escribo en su lugar");
  });

  it("offline disables the mic (text still usable) and recovery re-enables it", async () => {
    const recorder = fakeRecorder();
    const { renderer, setConnectivity } = renderScreen({ recorder });
    await act(async () => {});

    expect(mic(renderer).props.disabled).toBe(false);

    act(() => setConnectivity(false));
    expect(mic(renderer).props.disabled).toBe(true);
    expect(renderer.root.find((n) => n.props.testID === "voice-notice").props.children).toBe(
      "Voice needs a connection. You can keep typing.",
    );
    // Text fallback remains available offline.
    expect(
      renderer.root.findAll((n) => n.props.testID === "voice-text-input").length,
    ).toBeGreaterThanOrEqual(1);

    act(() => setConnectivity(true));
    expect(mic(renderer).props.disabled).toBe(false);
  });

  it("disables the mic while a turn streams (serialization)", async () => {
    const recorder = fakeRecorder();
    const stream = pendingStream();
    const { renderer } = renderScreen({ recorder, stream: stream.fn });
    await act(async () => {});

    // Drive a streaming turn via the text composer (keyboard toggle).
    act(() => renderer.root.find((n) => n.props.testID === "keyboard-btn").props.onPress());
    const input = renderer.root.find((n) => n.props.testID === "voice-text-input");
    act(() => input.props.onChangeText("hola"));
    act(() => {
      void renderer.root.find((n) => n.props.testID === "voice-send-btn").props.onPress();
    });

    expect(mic(renderer).props.disabled).toBe(true);

    await act(async () => {
      stream.finish();
    });
    expect(mic(renderer).props.disabled).toBe(false);
  });

  it("routes to Login on a 401 transcribe (session expiry)", async () => {
    const recorder = fakeRecorder();
    const transcribe = vi.fn(
      async (): Promise<TranscribeOutcome> => ({ kind: "error", status: 401, sessionExpired: true }),
    );
    const stream = scriptedStream([]);
    const { renderer, navigation, clearSession } = renderScreen({ recorder, transcribe, stream });
    await act(async () => {});

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    await act(async () => {
      await mic(renderer).props.onPressOut();
    });

    expect(clearSession).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "Login" }] });
    expect(stream).not.toHaveBeenCalled();
  });

  it("blocks a second recording while a transcribe is in flight (no overlap)", async () => {
    const recorder = fakeRecorder();
    const tx = deferred<TranscribeOutcome>();
    const transcribe = vi.fn(() => tx.promise);
    const { renderer } = renderScreen({ recorder, transcribe, stream: scriptedStream([]) });
    await act(async () => {});

    // First press-and-hold → the transcribe is now in flight (processing).
    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    act(() => {
      void mic(renderer).props.onPressOut();
    });
    await act(async () => {}); // flush recorder.stop() → status processing, transcribe pending
    expect(status(renderer)).toBe("Processing…");
    expect(recorder.start).toHaveBeenCalledTimes(1);
    // The mic must be disabled during the in-flight transcribe window.
    expect(mic(renderer).props.disabled).toBe(true);

    // A second press-and-hold during processing must be a complete no-op:
    // no second recording, no second transcribe (so the first AbortController
    // is never overwritten and the first turn is never shadowed).
    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    act(() => {
      void mic(renderer).props.onPressOut();
    });
    await act(async () => {});
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);

    // Resolve the first transcribe to settle the turn.
    await act(async () => {
      tx.resolve({ kind: "ok", text: "", unclear: true });
    });
  });

  it("aborts the in-flight transcribe and releases the recorder on unmount", async () => {
    const recorder = fakeRecorder();
    let capturedSignal: AbortSignal | undefined;
    const tx = deferred<TranscribeOutcome>();
    const transcribe = vi.fn((_audio: unknown, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return tx.promise;
    });
    const { renderer } = renderScreen({ recorder, transcribe, stream: scriptedStream([]) });
    await act(async () => {});

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    act(() => {
      void mic(renderer).props.onPressOut();
    });
    await act(async () => {}); // flush stop() → transcribe starts (pending)

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);

    act(() => renderer.unmount());
    expect(capturedSignal!.aborted).toBe(true);
    expect(recorder.release).toHaveBeenCalled();
  });
});
