import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { headers } from "next/headers";
import { loadMessages } from "@/i18n/locale";
import HomePage from "../page";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

// Wrap the real loadMessages so individual tests can force an empty catalogue
// (the production merge guarantees full English, so a missing-translation
// scenario must be injected) without affecting the other tests.
vi.mock("@/i18n/locale", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/locale")>();
  return { ...actual, loadMessages: vi.fn(actual.loadMessages) };
});

const mockedHeaders = vi.mocked(headers);
const mockedLoadMessages = vi.mocked(loadMessages);

describe("HomePage", () => {
  beforeEach(() => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "es-ES,es;q=0.9" }));
  });

  it("renders the landing page brand and hero content when lang=en is requested", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({ lang: "en" }) });
    const html = renderToString(page);

    // Brand is rendered
    expect(html).toContain("kInorA");
    // Hero content from the new landing
    expect(html).toContain("AI Coach");
    expect(html).toContain("Start free");
    expect(html).toContain("See how it works");
  });

  it("renders landing sections with i18n keys", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({ lang: "en" }) });
    const html = renderToString(page);

    // Trust strip
    expect(html).toContain("Adapts to your schedule");
    // How it works
    expect(html).toContain("From your goal to your routine in three steps");
    // Features
    expect(html).toContain("Everything you need, in one app");
    // Pricing
    expect(html).toContain("Start free, grow");
    // CTA
    expect(html).toContain("Your next routine is waiting");
    // Footer
    expect(html).toContain("Product");
    expect(html).toContain("Company");
    expect(html).toContain("Legal");
  });

  it("renders without crashing when no lang param is given", async () => {
    const page = await HomePage({ searchParams: Promise.resolve({}) });
    const html = renderToString(page);

    // Should detect es-ES from accept-language mock
    expect(html).toContain("kInorA");
  });

  it("degrades gracefully when the message catalogue is empty", async () => {
    // Force a catalogue with no keys so every `messages.x ?? ""` fallback is
    // exercised; the page must still render (non-i18n content like the Pro
    // price and currency symbol remains) instead of throwing.
    mockedLoadMessages.mockReturnValueOnce({});

    const page = await HomePage({ searchParams: Promise.resolve({ lang: "en" }) });
    const html = renderToString(page);

    expect(typeof html).toBe("string");
    expect(html).toContain("€");
  });
});
