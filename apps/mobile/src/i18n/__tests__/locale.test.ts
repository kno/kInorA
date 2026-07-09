import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isSupportedLocale, resolveMessages, SUPPORTED_LOCALES } from "../locale.js";

describe("locale", () => {
  it("defaults to en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("es");
  });

  it("isSupportedLocale accepts en/es and rejects anything else", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("es")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(false);
  });

  it("resolveMessages returns a flat id->string map for en", () => {
    const messages = resolveMessages("en");
    expect(messages["dashboard.logout"]).toBe("Log out");
    expect(messages["mobileTracker.retry"]).toBe("Retry");
  });

  it("resolveMessages returns es values with EN fallback for missing keys (Gap 2 parity)", () => {
    const messages = resolveMessages("es");
    expect(messages["dashboard.logout"]).toBe("Cerrar sesión");
    expect(messages["mobileTracker.retry"]).toBe("Reintentar");
  });
});
