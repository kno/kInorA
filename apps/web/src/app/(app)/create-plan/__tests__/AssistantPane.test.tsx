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
});
