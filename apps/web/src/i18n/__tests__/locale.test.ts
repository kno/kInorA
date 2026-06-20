import { describe, it, expect } from "vitest";
import { resolveLocale, loadMessages } from "../locale";
import type { SupportedLocale, Messages } from "../locale";

describe("resolveLocale", () => {
  // --- Scenario: Language detected from browser headers (spec: Accept-Language: es) ---
  it("returns 'es' when Accept-Language starts with 'es' and no lang param", () => {
    expect(resolveLocale("es-ES,es;q=0.9,en;q=0.8", null)).toBe("es");
  });

  // --- Scenario: English when browser prefers unsupported language ---
  it("returns 'en' when Accept-Language is an unsupported language and no lang param", () => {
    expect(resolveLocale("fr-FR,fr;q=0.9", null)).toBe("en");
  });

  // --- Scenario: Query string overrides browser header ---
  it("returns 'en' when langParam='en' overrides Accept-Language 'es'", () => {
    expect(resolveLocale("es-ES,es;q=0.9", "en")).toBe("en");
  });

  // --- Scenario: Unsupported language queried explicitly ---
  it("returns 'en' when langParam is an unsupported language like 'fr'", () => {
    expect(resolveLocale(null, "fr")).toBe("en");
  });

  // --- Triangulation: more edge cases ---
  it("returns 'en' when both Accept-Language and langParam are null", () => {
    expect(resolveLocale(null, null)).toBe("en");
  });

  it("returns 'es' when langParam='es' even with English Accept-Language", () => {
    expect(resolveLocale("en-US,en;q=0.9", "es")).toBe("es");
  });

  it("returns 'en' when Accept-Language contains 'en' but not as first preference", () => {
    expect(resolveLocale("fr;q=0.9,en;q=0.5", null)).toBe("en");
  });

  it("returns 'es' when langParam='es' overrides a null Accept-Language", () => {
    expect(resolveLocale(null, "es")).toBe("es");
  });
});

describe("loadMessages", () => {
  it("returns English messages when locale is 'en'", () => {
    const messages: Messages = loadMessages("en");
    expect(messages).toHaveProperty("title");
    expect(messages).toHaveProperty("subtitle");
    expect(messages).toHaveProperty("cta");
  });

  it("returns Spanish messages when locale is 'es'", () => {
    const messages: Messages = loadMessages("es");
    expect(messages).toHaveProperty("title");
    expect(messages).toHaveProperty("subtitle");
    expect(messages).toHaveProperty("cta");
    // Verify Spanish content is distinct from English
    expect(messages.subtitle).not.toBe(loadMessages("en").subtitle);
  });

  it("returns English messages for an unsupported locale (fallback)", () => {
    // loadMessages should never be called with unsupported locale because
    // resolveLocale handles that, but let's verify defensive behavior
    // @ts-expect-error - testing runtime behavior with invalid locale
    const messages = loadMessages("fr");
    expect(messages).toEqual(loadMessages("en"));
  });
});