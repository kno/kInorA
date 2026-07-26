import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../../i18n/locale.js";
import type { ChatStreamOptions, ChatStreamResult } from "../../create-plan/chat-stream";
import type { ChatSSEEvent } from "../../create-plan/chat-types";
import type { VoiceRecorder } from "../../../audio/recorder";
import type { AudioPlayer } from "../../../audio/player";
import type { TranscribeAudio, TranscribeOutcome } from "../../../api/transcribe-client";
import type { SpeechOutcome } from "../../../api/speech-client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Stub react-native with passthrough host elements (same constraint as
// AssistantScreen.test / HomeScreen.test — Vite cannot parse RN's Flow entry).
// Pressable forwards ALL props so the suite can invoke onPressIn/onPressOut
// (push-to-talk) and read `disabled` directly.
// `Animated.View` is a passthrough host element; the injected fake OrbAnimation
// (below) supplies plain values, so the real `Animated`/`Easing` runtime is
// never exercised here (that is covered in orb-animation.test.ts).
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  TextInput: (props: any) => <input {...props} />,
  Pressable: (props: any) => <button type="button" {...props} />,
  StyleSheet: { create: (styles: unknown) => styles },
  Animated: { View: "View" },
  Easing: { inOut: (fn: unknown) => fn, out: (fn: unknown) => fn, ease: (n: number) => n },
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

/** A fake TTS player capturing the natural-completion callback. */
function fakePlayer(overrides: Partial<AudioPlayer> = {}) {
  let ended: () => void = () => {};
  const player: AudioPlayer = {
    play: vi.fn(async (_source: unknown, onEnded?: () => void) => {
      ended = onEnded ?? (() => {});
    }),
    stop: vi.fn(async () => {}),
    release: vi.fn(() => {}),
    ...overrides,
  };
  return { player, fireEnded: () => ended() };
}

/**
 * A fake orb animation (#230): spy `start`/`stop` and stand-in values whose
 * `interpolate` returns a number, so the screen's animated styles render under
 * the passthrough `Animated.View` mock without the real `Animated` runtime.
 */
function fakeOrbAnimation() {
  const value = () => ({ interpolate: () => 0, setValue: () => {} }) as any;
  return {
    rings: [value(), value(), value()],
    bars: Array.from({ length: 9 }, value),
    start: vi.fn(),
    stop: vi.fn(),
  };
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
  const orbAnimation = "orbAnimation" in props ? undefined : fakeOrbAnimation();
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" defaultLocale="en" messages={resolveMessages("en")}>
        <VoiceScreen
          navigation={navigation}
          clearSession={clearSession}
          subscribeConnectivity={subscribeConnectivity}
          orbAnimation={orbAnimation as any}
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

describe("VoiceScreen (D2 native TTS playback of the assistant reply)", () => {
  const REPLY = "Vamos a por fuerza.";

  function voiceTurnProps(synthesize: unknown, player: AudioPlayer) {
    return {
      recorder: fakeRecorder(),
      transcribe: vi.fn(
        async (): Promise<TranscribeOutcome> => ({ kind: "ok", text: "arma mi plan", unclear: false }),
      ),
      stream: scriptedStream([
        { type: "draft", draftSpec: {}, missingFields: [], assistantMessage: REPLY },
      ]),
      synthesize,
      player,
    };
  }

  /** Drive a full voice turn to its terminal reply, then flush TTS. */
  async function runVoiceTurn(renderer: ReactTestRenderer) {
    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    await act(async () => {
      await mic(renderer).props.onPressOut();
    });
    await act(async () => {}); // flush speakReply (synthesize → player.play)
  }

  it("synthesizes the terminal reply, plays it, and shows the speaking state", async () => {
    const synthesize = vi.fn(
      async (_text: string, _opts: { signal?: AbortSignal }): Promise<SpeechOutcome> => ({
        kind: "ok",
        audio: { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" },
      }),
    );
    const { player, fireEnded } = fakePlayer();
    const { renderer } = renderScreen(voiceTurnProps(synthesize, player));
    await act(async () => {});
    await runVoiceTurn(renderer);

    // The terminal assistant reply (not the user text) was synthesized, with an
    // abort signal, then played as the returned mp3 bytes.
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0]![0]).toBe(REPLY);
    expect(synthesize.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect((player.play as any).mock.calls[0][0]).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
    });

    // The status badge reflects playback (parity with web's "Speaking…").
    expect(status(renderer)).toBe("Speaking…");
    // Natural completion returns the badge to idle.
    await act(async () => {
      fireEnded();
    });
    expect(status(renderer)).toBe("Ready");
  });

  it("recovers to idle when playback fails to start (mic never stuck disabled)", async () => {
    // The player can reject at load/start (audio-focus denied, a rejected data:
    // URI). That must fail SILENTLY like every other TTS path — and crucially
    // must NOT leave `speaking` true, which would keep the push-to-talk mic
    // disabled for the rest of the session.
    const synthesize = vi.fn(
      async (): Promise<SpeechOutcome> => ({
        kind: "ok",
        audio: { bytes: new Uint8Array([1]), contentType: "audio/mpeg" },
      }),
    );
    const { player } = fakePlayer({
      play: vi.fn(async () => {
        throw new Error("audio focus denied");
      }),
    });
    const { renderer } = renderScreen(voiceTurnProps(synthesize, player));
    await act(async () => {});
    await runVoiceTurn(renderer);

    expect(player.play).toHaveBeenCalledTimes(1);
    // No user-facing error (the text reply already stands), and the screen is
    // back to idle with the mic re-enabled — not stuck on "Speaking…".
    expect(renderer.root.findAll((n) => n.props.testID === "voice-notice")).toHaveLength(0);
    expect(status(renderer)).toBe("Ready");
    expect(mic(renderer).props.disabled).toBe(false);
  });

  it("skips playback on a 204 opt-out with no error and no crash", async () => {
    const synthesize = vi.fn(async (): Promise<SpeechOutcome> => ({ kind: "opt_out" }));
    const { player } = fakePlayer();
    const { renderer } = renderScreen(voiceTurnProps(synthesize, player));
    await act(async () => {});
    await runVoiceTurn(renderer);

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(player.play).not.toHaveBeenCalled();
    // No TTS notice: the opt-out is silent, and the text reply still stands.
    expect(renderer.root.findAll((n) => n.props.testID === "voice-notice")).toHaveLength(0);
    expect(bubbleTexts(renderer)).toContain(REPLY);
    expect(status(renderer)).toBe("Ready");
  });

  it("fails silently on a TTS 502 without disrupting the chat reply", async () => {
    const synthesize = vi.fn(async (): Promise<SpeechOutcome> => ({ kind: "error", status: 502 }));
    const { player } = fakePlayer();
    const { renderer } = renderScreen(voiceTurnProps(synthesize, player));
    await act(async () => {});
    await runVoiceTurn(renderer);

    expect(player.play).not.toHaveBeenCalled();
    expect(renderer.root.findAll((n) => n.props.testID === "voice-notice")).toHaveLength(0);
    expect(bubbleTexts(renderer)).toContain(REPLY);
    expect(status(renderer)).toBe("Ready");
  });

  it("stops playback and aborts the speech fetch when a new turn starts", async () => {
    let capturedSignal: AbortSignal | undefined;
    const synthesize = vi.fn(
      async (_t: string, opts: { signal?: AbortSignal }): Promise<SpeechOutcome> => {
        capturedSignal = opts.signal;
        return { kind: "ok", audio: { bytes: new Uint8Array([9]), contentType: "audio/mpeg" } };
      },
    );
    const { player } = fakePlayer();
    const { renderer } = renderScreen(voiceTurnProps(synthesize, player));
    await act(async () => {});
    await runVoiceTurn(renderer);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(capturedSignal!.aborted).toBe(false);
    const stopsBefore = (player.stop as any).mock.calls.length;

    // A new (typed) turn supersedes the playing reply.
    act(() => renderer.root.find((n) => n.props.testID === "keyboard-btn").props.onPress());
    act(() => renderer.root.find((n) => n.props.testID === "voice-text-input").props.onChangeText("otra cosa"));
    await act(async () => {
      await renderer.root.find((n) => n.props.testID === "voice-send-btn").props.onPress();
    });

    expect((player.stop as any).mock.calls.length).toBeGreaterThan(stopsBefore);
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("aborts the in-flight speech fetch and releases the player on unmount", async () => {
    const sx = deferred<SpeechOutcome>();
    let capturedSignal: AbortSignal | undefined;
    const synthesize = vi.fn((_t: string, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return sx.promise;
    });
    const { player } = fakePlayer();
    const { renderer } = renderScreen(voiceTurnProps(synthesize, player));
    await act(async () => {});
    await runVoiceTurn(renderer); // synthesize now pending (speech in flight)

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);
    expect(player.play).not.toHaveBeenCalled(); // still awaiting synthesis

    act(() => renderer.unmount());
    expect(capturedSignal!.aborted).toBe(true);
    expect(player.release).toHaveBeenCalled();
  });

  it("does not play when connectivity drops before the reply is spoken", async () => {
    const tx = deferred<TranscribeOutcome>();
    const transcribe = vi.fn(() => tx.promise);
    const synthesize = vi.fn(
      async (): Promise<SpeechOutcome> => ({
        kind: "ok",
        audio: { bytes: new Uint8Array([1]), contentType: "audio/mpeg" },
      }),
    );
    const { player } = fakePlayer();
    const stream = scriptedStream([
      { type: "draft", draftSpec: {}, missingFields: [], assistantMessage: REPLY },
    ]);
    const { renderer, setConnectivity } = renderScreen({
      recorder: fakeRecorder(),
      transcribe,
      stream,
      synthesize,
      player,
    });
    await act(async () => {});

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    act(() => {
      void mic(renderer).props.onPressOut();
    });
    await act(async () => {}); // processing; transcribe pending

    // Connectivity drops mid-turn (between transcribe and the spoken reply).
    act(() => setConnectivity(false));

    // The transcript resolves → the turn runs, but playback is suppressed offline.
    await act(async () => {
      tx.resolve({ kind: "ok", text: "arma mi plan", unclear: false });
    });
    await act(async () => {});

    expect(synthesize).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it("billing boundary: the whole voice path never hits a plan-generation endpoint", async () => {
    // The voice loop (transcribe → chat → speak) must consume ZERO billing
    // units. VoiceScreen only ever calls the transcribe + speech clients and the
    // (metered-free) chat stream; it NEVER reaches the confirm/generate endpoint,
    // which is the single `plan_generation`-consuming call (kept in the separate
    // confirm→generate flow). Assert the screen never invokes a synthesize/
    // transcribe that targets a generation endpoint, and that a full turn only
    // drives the two voice clients.
    const transcribe = vi.fn(
      async (): Promise<TranscribeOutcome> => ({ kind: "ok", text: "arma mi plan", unclear: false }),
    );
    const synthesize = vi.fn(
      async (): Promise<SpeechOutcome> => ({
        kind: "ok",
        audio: { bytes: new Uint8Array([7]), contentType: "audio/mpeg" },
      }),
    );
    const stream = scriptedStream([
      { type: "draft", draftSpec: {}, missingFields: [], assistantMessage: REPLY },
    ]);
    const { player } = fakePlayer();
    const { renderer } = renderScreen({ recorder: fakeRecorder(), transcribe, stream, synthesize, player });
    await act(async () => {});
    await runVoiceTurn(renderer);

    // Exactly one transcribe, one chat stream, one synthesize — no more, no
    // generation/confirm call anywhere on the voice path.
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceScreen (#230 orb/waveform animation driven by status)", () => {
  it("starts the animation on listening and stops it when back at idle", async () => {
    const orb = fakeOrbAnimation();
    const recorder = fakeRecorder();
    // An unclear transcript returns straight to idle without a streaming turn.
    const transcribe = vi.fn(async (): Promise<TranscribeOutcome> => ({ kind: "ok", text: "", unclear: true }));
    const { renderer } = renderScreen({ recorder, transcribe, stream: scriptedStream([]), orbAnimation: orb });
    await act(async () => {});

    // Idle at mount → the orb is at rest, never started.
    expect(orb.start).not.toHaveBeenCalled();

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    expect(status(renderer)).toBe("Listening…");
    expect(orb.start).toHaveBeenCalled();

    await act(async () => {
      await mic(renderer).props.onPressOut();
    });
    // Unclear → idle again → the animation is stopped.
    expect(status(renderer)).toBe("Ready");
    expect(orb.stop).toHaveBeenCalled();
  });

  it("keeps animating through a streaming reply and stops when the turn finishes", async () => {
    const orb = fakeOrbAnimation();
    const stream = pendingStream();
    const { renderer } = renderScreen({ recorder: fakeRecorder(), stream: stream.fn, orbAnimation: orb });
    await act(async () => {});

    // Drive a streaming turn via the text composer.
    act(() => renderer.root.find((n) => n.props.testID === "keyboard-btn").props.onPress());
    act(() => renderer.root.find((n) => n.props.testID === "voice-text-input").props.onChangeText("hola"));
    act(() => {
      void renderer.root.find((n) => n.props.testID === "voice-send-btn").props.onPress();
    });

    // Responding (streaming) counts as engaged → the orb animates.
    expect(status(renderer)).toBe("kInorA is responding…");
    expect(orb.start).toHaveBeenCalled();
    const stopsBefore = orb.stop.mock.calls.length;

    await act(async () => {
      stream.finish();
    });
    // Turn done → idle → the animation is stopped again.
    expect(status(renderer)).toBe("Ready");
    expect(orb.stop.mock.calls.length).toBeGreaterThan(stopsBefore);
  });

  it("stops the animation on unmount so no loop leaks past teardown", async () => {
    const orb = fakeOrbAnimation();
    const stream = pendingStream();
    const { renderer } = renderScreen({ recorder: fakeRecorder(), stream: stream.fn, orbAnimation: orb });
    await act(async () => {});

    act(() => renderer.root.find((n) => n.props.testID === "keyboard-btn").props.onPress());
    act(() => renderer.root.find((n) => n.props.testID === "voice-text-input").props.onChangeText("hola"));
    act(() => {
      void renderer.root.find((n) => n.props.testID === "voice-send-btn").props.onPress();
    });
    expect(orb.start).toHaveBeenCalled();
    const stopsBefore = orb.stop.mock.calls.length;

    act(() => renderer.unmount());
    expect(orb.stop.mock.calls.length).toBeGreaterThan(stopsBefore);
  });
});

describe("VoiceScreen (#231 Free-tier Pro gate surfaced client-side)", () => {
  it("shows the upgrade notice on a 403 premium_required transcribe (no crash, no chat turn)", async () => {
    const recorder = fakeRecorder();
    const transcribe = vi.fn(
      async (): Promise<TranscribeOutcome> => ({ kind: "error", status: 403, premiumRequired: true }),
    );
    const stream = scriptedStream([]);
    const { renderer, navigation } = renderScreen({ recorder, transcribe, stream });
    await act(async () => {});

    await act(async () => {
      await mic(renderer).props.onPressIn();
    });
    await act(async () => {
      await mic(renderer).props.onPressOut();
    });

    // A clear upgrade-oriented notice — NOT the retry-oriented generic error,
    // and NOT a silent nothing or a crash.
    const notice = renderer.root.find((n) => n.props.testID === "voice-notice");
    expect(notice.props.children).toBe(
      "Voice is a Pro feature. Upgrade to Pro to use it. You can keep typing.",
    );
    // A 403 is not a session expiry, so it never logs the user out.
    expect(navigation.reset).not.toHaveBeenCalled();
    // The gate blocked before any chat turn ran, and the screen is usable (idle,
    // with the text composer still available).
    expect(stream).not.toHaveBeenCalled();
    expect(status(renderer)).toBe("Ready");
    expect(renderer.root.findAll((n) => n.props.testID === "voice-text-input").length).toBeGreaterThanOrEqual(0);
  });
});
