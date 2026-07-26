import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../../i18n/locale.js";
import type { ChatStreamOptions, ChatStreamResult } from "../chat-stream";
import type { ChatSSEEvent } from "../chat-types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `react-native`'s entry point uses Flow's `import typeof` syntax Vite/Rollup
// cannot parse (no Metro/Babel transform in this Vitest env) — same constraint
// HomeScreen.test.tsx documents. Stub the handful of primitives the screen uses
// with passthrough host elements so the REAL component tree (its `useIntl()`
// calls, the store subscription) still renders and can be asserted on.
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  ScrollView: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  TextInput: (props: any) => <input {...props} />,
  Pressable: ({ children, style, onPress, ...rest }: any) => (
    <button type="button" onClick={onPress} {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  ActivityIndicator: "ActivityIndicator",
  StyleSheet: { create: (styles: unknown) => styles },
}));

// `../auth/session-storage` transitively imports `expo-secure-store` →
// `expo-modules-core`, which reads the RN global `__DEV__` at module scope
// (undefined outside a real RN/Expo runtime). The screen only calls
// `deleteSessionToken` on session expiry; stub it (and inject `clearSession`).
vi.mock("../../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(async () => {}),
}));

const AssistantScreen = (await import("../AssistantScreen.js")).default;

/** A scripted `runChatStream` stand-in: emits the events (via `onEvent`) and
 * resolves with the result. Captures the options for wiring assertions. */
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

/** A stream that stays in flight until `finish` is called. */
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
    finish: (r: ChatStreamResult = { aborted: false, sessionExpired: false }) => resolveFn(r),
  };
}

/** A complete, schema-valid spec — enables the "Generar plan" gate. */
const COMPLETE_SPEC = {
  goal: "strength" as const,
  location: "home" as const,
  daysPerWeek: 3,
  sessionDurationMinutes: 45,
  equipment: [] as string[],
  limitations: [] as { text: string; isWarning: boolean }[],
};

function renderScreen(props: Record<string, unknown> = {}) {
  const navigation = { navigate: vi.fn(), reset: vi.fn(), replace: vi.fn() } as any;
  const clearSession = vi.fn(async () => {});
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <IntlProvider locale="en" defaultLocale="en" messages={resolveMessages("en")}>
        <AssistantScreen navigation={navigation} clearSession={clearSession} {...props} />
      </IntlProvider>,
    );
  });
  return { renderer, navigation, clearSession };
}

function bubbleTexts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((n) => n.props.testID === "chat-bubble")
    .map((n) => n.props.children as string);
}

async function typeAndSend(renderer: ReactTestRenderer, text: string) {
  const input = renderer.root.find((n) => n.props.testID === "chat-input");
  act(() => input.props.onChangeText(text));
  const send = renderer.root.find((n) => n.props.testID === "send-btn");
  await act(async () => {
    await send.props.onPress();
  });
}

describe("AssistantScreen (C2b RN Asistente text-chat + extraction panel)", () => {
  it("seeds the greeting and streams assistant prose incrementally from the store", async () => {
    const { fn } = scriptedStream([
      { type: "token", delta: "He" },
      { type: "token", delta: "llo" },
    ]);
    const { renderer } = renderScreen({ stream: fn });

    // Greeting seeded from the chat i18n namespace.
    expect(bubbleTexts(renderer).length).toBe(1);

    await typeAndSend(renderer, "quiero fuerza");

    const texts = bubbleTexts(renderer);
    expect(texts).toContain("quiero fuerza"); // user bubble
    expect(texts.at(-1)).toBe("Hello"); // streamed assistant prose
  });

  it("populates the 'Datos extraídos' panel from the terminal draft event", async () => {
    const { fn } = scriptedStream([
      {
        type: "draft",
        draftSpec: { goal: "hypertrophy", daysPerWeek: 4 },
        missingFields: ["location"],
        assistantMessage: "Ajustado.",
      },
    ]);
    const { renderer } = renderScreen({ stream: fn });

    await typeAndSend(renderer, "arma mi plan");

    const days = renderer.root.find((n) => n.props.testID === "field-days");
    expect(days.props.value).toBe("4");
    const goalPill = renderer.root.find((n) => n.props.testID === "goal-hypertrophy");
    expect(goalPill.props.accessibilityState).toEqual({ selected: true });
  });

  it("send is disabled while a turn streams (serialization)", async () => {
    const pending = pendingStream();
    const { renderer } = renderScreen({ stream: pending.fn });

    const input = renderer.root.find((n) => n.props.testID === "chat-input");
    act(() => input.props.onChangeText("uno"));
    const send = renderer.root.find((n) => n.props.testID === "send-btn");
    act(() => {
      void send.props.onPress();
    });

    expect(renderer.root.find((n) => n.props.testID === "send-btn").props.disabled).toBe(true);
    // A second turn cannot start while one streams (serialization enforced in
    // the store): the second stream is never created.
    expect(pending.fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.finish();
    });
    // Streaming cleared → with fresh non-empty input the send re-enables.
    act(() => input.props.onChangeText("dos"));
    expect(renderer.root.find((n) => n.props.testID === "send-btn").props.disabled).toBe(false);
  });

  it("shows a retry affordance on a mid-stream error and recovers on retry without losing prior draft", async () => {
    // A stateful stream: the first turn errors after partial prose; the retry
    // (same message, no new user bubble) succeeds with a terminal draft.
    let call = 0;
    const stream = vi.fn((options: ChatStreamOptions): Promise<ChatStreamResult> => {
      call += 1;
      if (call === 1) {
        options.onEvent({ type: "token", delta: "partial" });
        options.onEvent({ type: "error", reason: "chat_stream_failed" });
      } else {
        options.onEvent({
          type: "draft",
          draftSpec: { goal: "strength" },
          missingFields: [],
          assistantMessage: "Ok.",
        });
      }
      return Promise.resolve({ aborted: false, sessionExpired: false });
    });
    const { renderer } = renderScreen({ stream, initialSpec: { goal: "strength" } });

    await typeAndSend(renderer, "intenta");

    // Error surfaced with a retry control; the prior draft is intact.
    expect(renderer.root.findAll((n) => n.props.testID === "chat-error").length).toBe(1);
    const goalPill = renderer.root.find((n) => n.props.testID === "goal-strength");
    expect(goalPill.props.accessibilityState).toEqual({ selected: true });

    // Retry re-runs the last turn; the error clears on success.
    const retryBtn = renderer.root.find((n) => n.props.testID === "retry-btn");
    await act(async () => {
      await retryBtn.props.onPress();
    });
    expect(stream).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAll((n) => n.props.testID === "chat-error").length).toBe(0);
    expect(bubbleTexts(renderer).at(-1)).toBe("Ok.");
  });

  it("gates 'Generar plan' on a valid spec and flows promote → confirm → navigate", async () => {
    const promoteDraft = vi.fn(async () => ({ kind: "ok" as const, id: "spec_1" }));
    const confirmPlan = vi.fn(async () => ({
      kind: "ok" as const,
      planId: "plan_9",
      status: "generating",
    }));
    const { fn } = scriptedStream([]);
    const { renderer, navigation } = renderScreen({
      stream: fn,
      initialSpec: COMPLETE_SPEC,
      client: { promoteDraft, confirmPlan },
    });

    const generate = renderer.root.find((n) => n.props.testID === "generate-btn");
    expect(generate.props.disabled).toBe(false);

    await act(async () => {
      await generate.props.onPress();
    });

    expect(promoteDraft).toHaveBeenCalledTimes(1);
    expect(confirmPlan).toHaveBeenCalledTimes(1);
    expect(confirmPlan).toHaveBeenCalledWith("spec_1", expect.anything());
    expect(navigation.navigate).toHaveBeenCalled();
  });

  it("keeps 'Generar plan' disabled when the spec is incomplete", () => {
    const { renderer } = renderScreen({ stream: scriptedStream([]).fn, initialSpec: { goal: "strength" } });
    const generate = renderer.root.find((n) => n.props.testID === "generate-btn");
    expect(generate.props.disabled).toBe(true);
  });

  it("disposes the store on unmount, aborting an in-flight turn", async () => {
    const pending = pendingStream();
    const { renderer } = renderScreen({ stream: pending.fn });

    // Fire the turn WITHOUT awaiting — a pending stream never resolves, so
    // awaiting `runTurn` would hang. The turn is in flight when we unmount.
    const input = renderer.root.find((n) => n.props.testID === "chat-input");
    act(() => input.props.onChangeText("uno"));
    const send = renderer.root.find((n) => n.props.testID === "send-btn");
    act(() => {
      void send.props.onPress();
    });
    const signal = pending.options!.signal!;
    expect(signal.aborted).toBe(false);

    act(() => renderer.unmount());
    expect(signal.aborted).toBe(true);
  });

  it("on session expiry clears the token and resets navigation to Login", async () => {
    const { fn } = scriptedStream(
      [{ type: "error", reason: "session_expired" }],
      { aborted: false, sessionExpired: true },
    );
    const { renderer, navigation, clearSession } = renderScreen({ stream: fn });

    await typeAndSend(renderer, "hola");

    expect(clearSession).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "Login" }] });
  });
});
