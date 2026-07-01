import { describe, it, expect, vi, beforeEach } from "vitest";
import { headers } from "next/headers";
import { getFirstParam, resolvePageI18n } from "../request";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

const mockedHeaders = vi.mocked(headers);

// ---------------------------------------------------------------------------
// getFirstParam
// ---------------------------------------------------------------------------

describe("getFirstParam", () => {
  it("returns null when value is undefined", () => {
    expect(getFirstParam(undefined)).toBeNull();
  });

  it("returns the string as-is when value is a plain string", () => {
    expect(getFirstParam("en")).toBe("en");
  });

  it("returns the first element when value is an array", () => {
    expect(getFirstParam(["es", "en"])).toBe("es");
  });

  it("returns null when value is an empty array", () => {
    expect(getFirstParam([])).toBeNull();
  });

  it("returns the only element of a single-element array", () => {
    expect(getFirstParam(["en"])).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// resolvePageI18n
// ---------------------------------------------------------------------------

describe("resolvePageI18n", () => {
  beforeEach(() => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "en-US,en;q=0.9" }));
  });

  it("resolves to 'en' locale and loads English messages when langParam is 'en'", async () => {
    const { locale, messages } = await resolvePageI18n("en");
    expect(locale).toBe("en");
    expect(messages.auth_login_title).toBeTruthy();
  });

  it("resolves to 'es' locale and loads Spanish messages when langParam is 'es'", async () => {
    const { locale, messages } = await resolvePageI18n("es");
    expect(locale).toBe("es");
    expect(messages.auth_login_title).toBe("Iniciar sesión");
  });

  it("falls back to Accept-Language header when langParam is null", async () => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "es-ES,es;q=0.9" }));
    const { locale } = await resolvePageI18n(null);
    expect(locale).toBe("es");
  });

  it("falls back to English when langParam is null and Accept-Language is unsupported", async () => {
    mockedHeaders.mockResolvedValue(new Headers({ "accept-language": "fr-FR,fr;q=0.9" }));
    const { locale } = await resolvePageI18n(null);
    expect(locale).toBe("en");
  });

  it("awaits headers() (async call — resolves correctly without throwing)", async () => {
    // Confirm the mock was called as a Promise (async headers())
    const result = resolvePageI18n(null);
    await expect(result).resolves.toHaveProperty("locale");
    expect(mockedHeaders).toHaveBeenCalled();
  });
});
