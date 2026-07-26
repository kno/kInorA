// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { AssistantPane } from "../AssistantPane";
import type { ChatDraftSpec } from "../chat-types";

/** Encode SSE frames into a single auto-closing ReadableStream. */
function eagerStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(encoder.encode(frames[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

/** A stream the test drives frame-by-frame and closes on demand. */
function controllableStream() {
  const encoder = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
    },
  });
  return {
    stream,
    push: (frame: string) => act(() => ctrl.enqueue(encoder.encode(frame))),
    close: () => act(() => ctrl.close()),
  };
}

function mockFetchOnce(body: ReadableStream<Uint8Array>, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const noopGenerate = () => Promise.resolve();
const noopPersist = () => Promise.resolve();

function setup(overrides: Partial<Parameters<typeof AssistantPane>[0]> = {}) {
  const onSpecChange = vi.fn();
  const persistSpec = vi.fn().mockResolvedValue(undefined);
  const onGenerate = vi.fn().mockResolvedValue(undefined);
  renderWithIntl(
    <AssistantPane
      spec={overrides.spec ?? {}}
      onSpecChange={overrides.onSpecChange ?? onSpecChange}
      persistSpec={overrides.persistSpec ?? persistSpec}
      onGenerate={overrides.onGenerate ?? onGenerate}
    />,
  );
  return { onSpecChange, persistSpec, onGenerate };
}

async function sendTurn(text = "build muscle 4 days a week") {
  const input = screen.getByRole("textbox", { name: /chat message/i });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /send message/i }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AssistantPane — SSE consumer", () => {
  it("renders assistant prose incrementally as token frames arrive", async () => {
    mockFetchOnce(
      eagerStream([
        'event: token\ndata: {"delta":"Got "}\n\n',
        'event: token\ndata: {"delta":"it."}\n\n',
        'event: draft\ndata: {"draftSpec":{},"missingFields":[],"assistantMessage":"Got it."}\n\n',
      ]),
    );
    setup();
    await sendTurn();
    await waitFor(() => {
      expect(screen.getByText("Got it.")).toBeTruthy();
    });
  });

  it("populates the Datos extraídos panel from the terminal draft event", async () => {
    const onSpecChange = vi.fn();
    mockFetchOnce(
      eagerStream([
        'event: draft\ndata: {"draftSpec":{"goal":"hypertrophy","daysPerWeek":4},"missingFields":["location"],"assistantMessage":"Done."}\n\n',
      ]),
    );
    setup({ onSpecChange });
    await sendTurn();
    await waitFor(() => {
      expect(onSpecChange).toHaveBeenCalledWith({ goal: "hypertrophy", daysPerWeek: 4 });
    });
  });

  it("shows a retry affordance on a terminal error without losing prior draft state", async () => {
    mockFetchOnce(
      eagerStream(['event: error\ndata: {"error":"chat_stream_failed"}\n\n']),
    );
    setup({ spec: { goal: "strength" } });
    await sendTurn();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
    // The already-captured field is still shown in the panel.
    expect(screen.getByText(/Strength/i)).toBeTruthy();
  });

  it("renders no empty coach bubble on a terminal error, and retry does not duplicate the user message or leave a stray blank bubble", async () => {
    // First attempt fails; the retry succeeds with a normal assistant reply.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: eagerStream(['event: error\ndata: {"error":"chat_stream_failed"}\n\n']),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: eagerStream([
          'event: draft\ndata: {"draftSpec":{},"missingFields":[],"assistantMessage":"All set."}\n\n',
        ]),
      });
    vi.stubGlobal("fetch", fetchMock);

    setup();
    await sendTurn("build muscle 4 days a week");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    });

    // No blank coach bubble rendered after the error: every assistant message
    // container must have non-empty text.
    const assistantBubbles = document.querySelectorAll('[data-role="assistant"]');
    for (const bubble of assistantBubbles) {
      expect(bubble.textContent?.trim()).not.toBe("");
    }
    // Exactly one user bubble so far.
    expect(
      screen.getAllByText("build muscle 4 days a week").length,
    ).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText("All set.")).toBeTruthy();
    });

    // Retry must NOT duplicate the user message.
    expect(
      screen.getAllByText("build muscle 4 days a week").length,
    ).toBe(1);
    // Fetch called exactly twice: original attempt + one retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serializes turns: the send control is disabled while a stream is in flight", async () => {
    const driver = controllableStream();
    mockFetchOnce(driver.stream);
    setup();
    await sendTurn();
    // First token flushed, stream still open → send must be disabled.
    driver.push('event: token\ndata: {"delta":"…"}\n\n');
    await waitFor(() => {
      const send = screen.getByRole("button", { name: /send message/i }) as HTMLButtonElement;
      expect(send.disabled).toBe(true);
    });
    driver.push('event: draft\ndata: {"draftSpec":{},"missingFields":[],"assistantMessage":"ok"}\n\n');
    driver.close();
  });

  it("aborts the in-flight request when the component unmounts", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const driver = controllableStream();
    mockFetchOnce(driver.stream);
    const { unmount } = renderWithIntl(
      <AssistantPane spec={{}} onSpecChange={vi.fn()} persistSpec={noopPersist} onGenerate={noopGenerate} />,
    );
    const input = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    driver.push('event: token\ndata: {"delta":"x"}\n\n');
    await waitFor(() => expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
    unmount();
    expect(abortSpy).toHaveBeenCalled();
    driver.close();
  });

  it("passes an AbortSignal to fetch so the turn is cancelable", async () => {
    const fetchMock = mockFetchOnce(
      eagerStream(['event: draft\ndata: {"draftSpec":{},"missingFields":[],"assistantMessage":"ok"}\n\n']),
    );
    setup();
    await sendTurn();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("AssistantPane — Datos extraídos panel field edits", () => {
  it("editField persists a goal edit via persistSpec and updates onSpecChange", async () => {
    const onSpecChange = vi.fn();
    const persistSpec = vi.fn().mockResolvedValue(undefined);
    setup({ onSpecChange, persistSpec, spec: { location: "gym" } });

    fireEvent.change(screen.getByLabelText(/edit goal/i), { target: { value: "hypertrophy" } });

    expect(onSpecChange).toHaveBeenCalledWith({ location: "gym", goal: "hypertrophy" });
    await waitFor(() => {
      expect(persistSpec).toHaveBeenCalledWith({ location: "gym", goal: "hypertrophy" });
    });
  });

  it("editField clears the goal back to unset when the blank option is chosen", () => {
    const onSpecChange = vi.fn();
    setup({ onSpecChange, spec: { goal: "strength" } });

    fireEvent.change(screen.getByLabelText(/edit goal/i), { target: { value: "" } });

    expect(onSpecChange).toHaveBeenCalledWith({ goal: undefined });
  });

  it("editField persists a location edit", async () => {
    const persistSpec = vi.fn().mockResolvedValue(undefined);
    setup({ persistSpec, spec: {} });

    fireEvent.change(screen.getByLabelText(/edit location/i), { target: { value: "outdoor" } });

    await waitFor(() => {
      expect(persistSpec).toHaveBeenCalledWith({ location: "outdoor" });
    });
  });

  it("editField persists a daysPerWeek edit, mapping a blank value to undefined", async () => {
    const onSpecChange = vi.fn();
    setup({ onSpecChange, spec: { daysPerWeek: 3 } });

    const daysInput = screen.getByLabelText(/edit days/i);
    fireEvent.change(daysInput, { target: { value: "5" } });
    expect(onSpecChange).toHaveBeenCalledWith({ daysPerWeek: 5 });

    fireEvent.change(daysInput, { target: { value: "" } });
    expect(onSpecChange).toHaveBeenCalledWith({ daysPerWeek: undefined });
  });

  it("editField persists a sessionDurationMinutes edit, mapping a blank value to undefined", async () => {
    const onSpecChange = vi.fn();
    setup({ onSpecChange, spec: { sessionDurationMinutes: 45 } });

    const durationInput = screen.getByLabelText(/edit session length/i);
    fireEvent.change(durationInput, { target: { value: "90" } });
    expect(onSpecChange).toHaveBeenCalledWith({ sessionDurationMinutes: 90 });

    fireEvent.change(durationInput, { target: { value: "" } });
    expect(onSpecChange).toHaveBeenCalledWith({ sessionDurationMinutes: undefined });
  });

  it("shows the read-only experience level when provided by the profile", () => {
    setup({ spec: {} });
    cleanup();
    renderWithIntl(
      <AssistantPane
        spec={{}}
        onSpecChange={vi.fn()}
        persistSpec={noopPersist}
        onGenerate={noopGenerate}
        experienceLevel="intermediate"
      />,
    );
    expect(screen.getByText("intermediate")).toBeTruthy();
  });
});

describe("AssistantPane — input keyboard handling", () => {
  it("Enter (without Shift) sends the message", async () => {
    mockFetchOnce(eagerStream(['event: draft\ndata: {"draftSpec":{},"missingFields":[],"assistantMessage":"ok"}\n\n']));
    setup();
    const input = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await waitFor(() => expect(screen.getByText("hello")).toBeTruthy());
  });

  it("Shift+Enter does NOT send the message (allows a newline)", () => {
    const fetchMock = mockFetchOnce(eagerStream([]));
    setup();
    const input = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    // The draft stays in the input — no turn was sent.
    expect((input as HTMLTextAreaElement).value).toBe("hello");
  });

  it("a non-Enter key does not trigger send", () => {
    const fetchMock = mockFetchOnce(eagerStream([]));
    setup();
    const input = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AssistantPane — error message resolution", () => {
  it("falls back to the generic error copy for an unrecognized reason", async () => {
    mockFetchOnce(eagerStream(['event: error\ndata: {"error":"something_else"}\n\n']));
    setup();
    await sendTurn();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows the generic error copy when fetch resolves with a non-ok response and no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, body: null }));
    setup();
    await sendTurn();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    });
  });
});

describe("AssistantPane — generation gate", () => {
  it("enables Generate only when the spec is complete and routes through onGenerate", async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const complete: ChatDraftSpec = {
      goal: "strength",
      location: "gym",
      daysPerWeek: 3,
      sessionDurationMinutes: 60,
      equipment: ["barbell"],
      limitations: [],
    };
    mockFetchOnce(eagerStream([]));
    setup({ spec: complete, onGenerate });
    const generate = screen.getByRole("button", { name: /generate plan/i }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
  });

  it("disables Generate when required fields are missing", () => {
    mockFetchOnce(eagerStream([]));
    setup({ spec: { goal: "strength" } });
    const generate = screen.getByRole("button", { name: /generate plan/i }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });

  it("disables Generate when daysPerWeek is out of range (0), even though all fields are present", () => {
    mockFetchOnce(eagerStream([]));
    const outOfRange: ChatDraftSpec = {
      goal: "strength",
      location: "gym",
      daysPerWeek: 0,
      sessionDurationMinutes: 60,
      equipment: ["barbell"],
      limitations: [],
    };
    setup({ spec: outOfRange });
    const generate = screen.getByRole("button", { name: /generate plan/i }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });

  it("disables Generate when sessionDurationMinutes is out of range (10, below the 15-minute floor)", () => {
    mockFetchOnce(eagerStream([]));
    const outOfRange: ChatDraftSpec = {
      goal: "strength",
      location: "gym",
      daysPerWeek: 3,
      sessionDurationMinutes: 10,
      equipment: ["barbell"],
      limitations: [],
    };
    setup({ spec: outOfRange });
    const generate = screen.getByRole("button", { name: /generate plan/i }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });
});

// --- Voice capture sub-mode (13 Slice B1) ---

/**
 * Minimal MediaRecorder fake: `start()` flips to recording, `stop()` emits one
 * data chunk then fires `onstop` synchronously (the component builds the Blob
 * and kicks off transcription from that handler).
 */
class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio-bytes"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function installVoice(getUserMedia: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);
}

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

/** Route fetch by URL: `/create-plan/transcribe` vs `/create-plan/chat`. */
function routeFetch(handlers: {
  transcribe: () => Promise<unknown>;
  chat?: () => Promise<unknown>;
}) {
  const fetchMock = vi.fn((url: string) => {
    if (String(url).includes("transcribe")) return handlers.transcribe();
    return (handlers.chat ?? (() => Promise.reject(new Error("no chat handler"))))();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderVoicePane() {
  renderWithIntl(
    <AssistantPane
      spec={{}}
      onSpecChange={vi.fn()}
      persistSpec={() => Promise.resolve()}
      onGenerate={() => Promise.resolve()}
    />,
  );
}

const micStart = () => screen.getByRole("button", { name: /start voice input/i });
const micStop = () => screen.getByRole("button", { name: /stop recording/i });

afterEach(() => {
  // installVoice defines a non-global property; vi.unstubAllGlobals (top-level
  // afterEach) does not remove it, so clear it here.
  if (Object.getOwnPropertyDescriptor(navigator, "mediaDevices")) {
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  }
});

describe("AssistantPane — voice capture (B1)", () => {
  it("push-to-talk records, transcribes, and feeds the transcript into the existing chat turn", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    installVoice(getUserMedia);
    const fetchMock = routeFetch({
      transcribe: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ text: "build muscle four days a week", unclear: false }),
        }),
      chat: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          body: eagerStream([
            'event: draft\ndata: {"draftSpec":{"goal":"hypertrophy"},"missingFields":[],"assistantMessage":"Got it."}\n\n',
          ]),
        }),
    });

    renderVoicePane();
    // Wait for feature-detection effect to enable the mic.
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(micStart());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    // Recording → the control now offers "stop".
    await waitFor(() => expect(micStop()).toBeTruthy());

    fireEvent.click(micStop());

    // The transcript is fed into runTurn: it appears as a user bubble and the
    // terminal assistant reply renders.
    await waitFor(() => expect(screen.getByText("build muscle four days a week")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Got it.")).toBeTruthy());

    // Two calls: the transcribe proxy, then the existing chat proxy.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/create-plan/transcribe"))).toBe(true);
    expect(urls.some((u) => u.includes("/create-plan/chat"))).toBe(true);
  });

  it("an unclear/empty transcript re-prompts and does NOT start a chat turn", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    installVoice(getUserMedia);
    const fetchMock = routeFetch({
      transcribe: () =>
        Promise.resolve({ ok: true, status: 200, json: async () => ({ text: "", unclear: true }) }),
    });

    renderVoicePane();
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(micStart());
    await waitFor(() => expect(micStop()).toBeTruthy());
    fireEvent.click(micStop());

    await waitFor(() => expect(screen.getByText(/didn't catch that/i)).toBeTruthy());
    // Only the transcribe call happened — no chat turn was started.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/create-plan/chat"))).toBe(false);
  });

  it("shows a processing state during transcription and disables the mic until it resolves", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    installVoice(getUserMedia);
    let resolveTranscribe!: (v: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveTranscribe = resolve;
    });
    routeFetch({
      transcribe: () => pending as Promise<unknown>,
      chat: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          body: eagerStream([
            'event: draft\ndata: {"draftSpec":{},"missingFields":[],"assistantMessage":"ok"}\n\n',
          ]),
        }),
    });

    renderVoicePane();
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(micStart());
    await waitFor(() => expect(micStop()).toBeTruthy());
    fireEvent.click(micStop());

    // Transcription in flight → processing status + disabled mic.
    await waitFor(() => expect(screen.getByText(/processing/i)).toBeTruthy());
    expect((micStart() as HTMLButtonElement).disabled).toBe(true);

    resolveTranscribe({ ok: true, status: 200, json: async () => ({ text: "hi", unclear: false }) });
    await waitFor(() => expect(screen.getByText("hi")).toBeTruthy());
  });

  it("microphone permission denied falls back to text and disables the mic without crashing", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    installVoice(getUserMedia);
    routeFetch({ transcribe: () => Promise.reject(new Error("should not be called")) });

    renderVoicePane();
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(micStart());

    await waitFor(() => expect(screen.getByText(/microphone access/i)).toBeTruthy());
    // Mic affordance disabled after denial…
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(true));
    // …but the text input stays fully usable.
    const input = screen.getByRole("textbox", { name: /chat message/i }) as HTMLTextAreaElement;
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "typed instead" } });
    expect(input.value).toBe("typed instead");
  });

  it("offline disables voice with a text fallback, and reconnecting re-enables it without a reload", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    installVoice(getUserMedia);
    routeFetch({ transcribe: () => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }) });

    renderVoicePane();
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(false));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/needs a connection/i)).toBeTruthy();
    // Text input remains usable while offline.
    expect((screen.getByRole("textbox", { name: /chat message/i }) as HTMLTextAreaElement).disabled).toBe(
      false,
    );

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect((micStart() as HTMLButtonElement).disabled).toBe(false));
  });

  it("disables the mic when voice is unsupported (no MediaRecorder/getUserMedia) and keeps text usable", async () => {
    // No installVoice() → jsdom has neither mediaDevices nor MediaRecorder.
    routeFetch({ transcribe: () => Promise.reject(new Error("unused")) });
    renderVoicePane();
    await waitFor(() =>
      expect(screen.getByText(/isn't available in this browser/i)).toBeTruthy(),
    );
    expect((micStart() as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: /chat message/i }) as HTMLTextAreaElement).disabled).toBe(
      false,
    );
  });
});
