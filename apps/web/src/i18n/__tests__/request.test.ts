import { describe, it, expect, vi } from "vitest";
import { headers } from "next/headers";
import { getFirstParam } from "../request";
import getRequestConfigDefault from "../request";

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

// `next-intl/server`'s `getRequestConfig` is framework wiring around the
// callback we pass it (selecting its RSC build requires the "react-server"
// resolve condition Next's own bundler sets, which isn't present under
// Vitest). Passing the callback straight through lets these tests exercise
// OUR locale-resolution/merge/onError logic without depending on that.
vi.mock("next-intl/server", () => ({
  getRequestConfig: (callback: (params: unknown) => unknown) => callback,
}));

// Synthetic fixture: `es` is deliberately MISSING a key `en` has, so the
// Gap-2 EN-fallback test below actually exercises request.ts wiring
// `en` in as the `mergeWithBase` base. The real catalogs have full 325/325
// parity (enforced by the packages/i18n guard), so they can never prove
// this path — `mergeWithBase` itself is already unit-tested in
// packages/i18n; this file only proves request.ts wires it correctly.
vi.mock("@kinora/i18n", async () => {
  const actual = await vi.importActual<typeof import("@kinora/i18n")>("@kinora/i18n");
  return {
    ...actual,
    catalogs: {
      en: { marketing: { title: "kInorA", onlyInEn: "EN fallback value" } },
      es: { marketing: { title: "kInorA ES" } },
    },
  };
});

const mockedHeaders = vi.mocked(headers);

/**
 * `getRequestConfig`'s return type wraps the callback in a function that
 * still expects `GetRequestConfigParams` (unused here — locale resolution is
 * header-driven, not segment-driven). `requestLocale` is always `undefined`
 * in this "without i18n routing" setup.
 */
function callRequestConfig() {
  return getRequestConfigDefault({ requestLocale: Promise.resolve(undefined) });
}

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
// getRequestConfig (default export, consumed by createNextIntlPlugin)
// ---------------------------------------------------------------------------

describe("getRequestConfig", () => {
  it("resolves to 'es' when x-kinora-lang is 'es', even over an 'en' Accept-Language header (header wins)", async () => {
    mockedHeaders.mockResolvedValue(
      new Headers({ "accept-language": "en-US,en;q=0.9", "x-kinora-lang": "es" })
    );
    const { locale } = await callRequestConfig();
    expect(locale).toBe("es");
  });

  it("resolves straight to 'en' for an invalid x-kinora-lang value, without falling through to Accept-Language", async () => {
    mockedHeaders.mockResolvedValue(
      new Headers({ "accept-language": "es-ES,es;q=0.9", "x-kinora-lang": "fr" })
    );
    const { locale } = await callRequestConfig();
    expect(locale).toBe("en");
  });

  it("falls back to the en value for a key missing in the es catalog (Gap 2 deep-merge)", async () => {
    mockedHeaders.mockResolvedValue(new Headers({ "x-kinora-lang": "es" }));
    const { messages } = await callRequestConfig();
    // `onlyInEn` is present ONLY in the mocked `en` fixture (see the
    // `@kinora/i18n` mock above) — it must still resolve through the en
    // base when the active locale is `es`, and the `es`-present sibling
    // key must keep the `es` value (locale wins where present).
    const nestedMessages = messages as { marketing: { title: string; onlyInEn: string } };
    expect(nestedMessages.marketing.onlyInEn).toBe("EN fallback value");
    expect(nestedMessages.marketing.title).toBe("kInorA ES");
  });

  it("swallows MISSING_MESSAGE without logging, but logs other error codes", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedHeaders.mockResolvedValue(new Headers({ "x-kinora-lang": "en" }));
    const { onError } = await callRequestConfig();

    onError?.({ code: "MISSING_MESSAGE", message: "Missing" } as never);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    onError?.({ code: "MISSING_FORMAT", message: "Bad format" } as never);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
