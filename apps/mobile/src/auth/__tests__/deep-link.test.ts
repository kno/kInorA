import { describe, it, expect } from "vitest";
import { parseDeepLinkCallback, isAllowedRedirectUrl } from "../deep-link";

describe("parseDeepLinkCallback", () => {
  it("extracts code and state from a kinora:// callback URL", () => {
    const url = "kinora://auth/callback?code=abc123&state=xyz789";
    const result = parseDeepLinkCallback(url);

    expect(result).toEqual({ code: "abc123", state: "xyz789" });
  });

  // Triangle: missing code
  it("returns null when the code parameter is missing", () => {
    const url = "kinora://auth/callback?state=xyz789";
    expect(parseDeepLinkCallback(url)).toBeNull();
  });

  // Triangle: missing state
  it("returns null when the state parameter is missing", () => {
    const url = "kinora://auth/callback?code=abc123";
    expect(parseDeepLinkCallback(url)).toBeNull();
  });

  // Triangle: completely invalid URL
  it("returns null for an invalid URL format", () => {
    expect(parseDeepLinkCallback("not-a-url")).toBeNull();
  });

  // Triangle: wrong scheme
  it("returns null for a non-kinora scheme", () => {
    expect(parseDeepLinkCallback("https://evil.com/callback?code=c&state=s")).toBeNull();
  });

  // Triangle: empty code/state values
  it("returns null when code or state are empty strings", () => {
    expect(parseDeepLinkCallback("kinora://auth/callback?code=&state=s")).toBeNull();
    expect(parseDeepLinkCallback("kinora://auth/callback?code=c&state=")).toBeNull();
  });
});

describe("isAllowedRedirectUrl", () => {
  const allowlist = [
    "kinora://auth/callback",
    "https://kinora.app/auth/callback",
  ];

  it("allows URLs that match an allowlist entry exactly", () => {
    expect(isAllowedRedirectUrl("kinora://auth/callback?code=c&state=s", allowlist)).toBe(true);
    expect(isAllowedRedirectUrl("https://kinora.app/auth/callback?code=c&state=s", allowlist)).toBe(true);
  });

  // Triangle: URL not in allowlist
  it("rejects URLs that do not match any allowlist entry", () => {
    expect(isAllowedRedirectUrl("https://evil.com/callback?code=c&state=s", allowlist)).toBe(false);
    expect(isAllowedRedirectUrl("kinora://evil/callback?code=c&state=s", allowlist)).toBe(false);
  });

  // Triangle: empty allowlist
  it("rejects all URLs when the allowlist is empty", () => {
    expect(isAllowedRedirectUrl("kinora://auth/callback", [])).toBe(false);
  });

  // Triangle: origin match with query params (allowlist has base URL without params)
  it("allows URLs whose origin+pathname matches an allowlist entry, ignoring query params", () => {
    expect(isAllowedRedirectUrl("kinora://auth/callback?code=c&state=s&extra=1", allowlist)).toBe(true);
  });
});
