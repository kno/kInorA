import { describe, it, expect } from "vitest";
import { MockPlanSpecExtractor } from "../mock-extractor.js";
import type { ChatExtractInput } from "../extraction-port.js";

const input: ChatExtractInput = {
  message: "I want to build muscle 4 days a week with dumbbells at the gym for 45 minutes",
  currentDraft: {},
};

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const token of stream) out.push(token);
  return out;
}

describe("MockPlanSpecExtractor", () => {
  const extractor = new MockPlanSpecExtractor();

  it("extract returns a deterministic PlanSpecDraft for a fixed message", async () => {
    const a = await extractor.extract(input, "some reply");
    const b = await extractor.extract(input, "another reply");
    expect(a).toEqual(b);
  });

  it("extract pulls the goal, days, duration, location and equipment from the message", async () => {
    const draft = await extractor.extract(input, "");
    expect(draft.goal).toBe("hypertrophy");
    expect(draft.daysPerWeek).toBe(4);
    expect(draft.sessionDurationMinutes).toBe(45);
    expect(draft.location).toBe("gym");
    expect(draft.equipment).toEqual(["dumbbells"]);
  });

  it("extract scans the user message and ignores the assistantReply argument", async () => {
    // The mock's keyword scan is over `input.message` only — a wildly different
    // assistantReply must not change the deterministic extraction.
    const draft = await extractor.extract(input, "You should train 1 day a week at home");
    expect(draft.daysPerWeek).toBe(4);
    expect(draft.location).toBe("gym");
  });

  it("extract never sets preferenceScores or confirmed", async () => {
    const draft = await extractor.extract(input, "");
    expect(draft).not.toHaveProperty("preferenceScores");
    expect(draft).not.toHaveProperty("confirmed");
  });

  it("extract returns an empty draft when nothing is recognizable", async () => {
    const draft = await extractor.extract({ message: "hello there", currentDraft: {} }, "");
    expect(draft).toEqual({});
  });

  it("streamReply yields the same deterministic token sequence every call", async () => {
    const signal = new AbortController().signal;
    const first = await collect(extractor.streamReply(input, signal));
    const second = await collect(extractor.streamReply(input, signal));
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("streamReply tokens reassemble into a non-empty assistant message", async () => {
    const tokens = await collect(extractor.streamReply(input, new AbortController().signal));
    expect(tokens.join("").length).toBeGreaterThan(0);
  });

  it("streamReply honors an already-aborted signal and yields nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const tokens = await collect(extractor.streamReply(input, controller.signal));
    expect(tokens).toEqual([]);
  });

  it("streamReply stops once the signal aborts mid-stream", async () => {
    const controller = new AbortController();
    const tokens: string[] = [];
    for await (const token of extractor.streamReply(input, controller.signal)) {
      tokens.push(token);
      controller.abort();
    }
    expect(tokens.length).toBe(1);
  });
});
