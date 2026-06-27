import { describe, it, expect, afterEach } from "vitest";
import { resolvePublicOrigin } from "../origin";

function makeRequest(
  url: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, { headers });
}

describe("resolvePublicOrigin", () => {
  const envKey = "WEB_PUBLIC_ORIGIN";

  afterEach(() => {
    delete process.env[envKey];
  });

  it("returns WEB_PUBLIC_ORIGIN origin when the env var is set and valid", () => {
    process.env[envKey] = "https://kinora.aitsai.com";
    const req = makeRequest("http://localhost:3000/callback/social", {
      "x-forwarded-host": "should-be-ignored.com",
      "x-forwarded-proto": "https",
    });
    expect(resolvePublicOrigin(req)).toBe("https://kinora.aitsai.com");
  });

  it("ignores headers and uses env var even when both are present", () => {
    process.env[envKey] = "https://prod.example.com";
    const req = makeRequest("http://localhost:3000/callback", {
      "x-forwarded-host": "proxy.example.com",
      "x-forwarded-proto": "https",
    });
    expect(resolvePublicOrigin(req)).toBe("https://prod.example.com");
  });

  it("returns forwarded origin when x-forwarded-proto and x-forwarded-host are present and no env var", () => {
    const req = makeRequest("http://localhost:3000/callback/social", {
      "x-forwarded-host": "kinora.aitsai.com",
      "x-forwarded-proto": "https",
    });
    expect(resolvePublicOrigin(req)).toBe("https://kinora.aitsai.com");
  });

  it("handles comma-separated x-forwarded-host and uses the first value", () => {
    const req = makeRequest("http://localhost:3000/callback/social", {
      "x-forwarded-host": "kinora.aitsai.com, internal.proxy.local",
      "x-forwarded-proto": "https",
    });
    expect(resolvePublicOrigin(req)).toBe("https://kinora.aitsai.com");
  });

  it("handles comma-separated x-forwarded-proto and uses the first value", () => {
    const req = makeRequest("http://localhost:3000/callback/social", {
      "x-forwarded-host": "kinora.aitsai.com",
      "x-forwarded-proto": "https, http",
    });
    expect(resolvePublicOrigin(req)).toBe("https://kinora.aitsai.com");
  });

  it("falls back to request.url origin when neither env nor forwarded headers are present", () => {
    const req = makeRequest("http://localhost:3000/callback/social");
    expect(resolvePublicOrigin(req)).toBe("http://localhost:3000");
  });

  it("skips a malformed WEB_PUBLIC_ORIGIN and falls through to forwarded headers", () => {
    process.env[envKey] = "not-a-valid-url";
    const req = makeRequest("http://localhost:3000/callback/social", {
      "x-forwarded-host": "kinora.aitsai.com",
      "x-forwarded-proto": "https",
    });
    expect(resolvePublicOrigin(req)).toBe("https://kinora.aitsai.com");
  });

  it("skips malformed WEB_PUBLIC_ORIGIN and falls back to request.url when no forwarded headers", () => {
    process.env[envKey] = "not-a-valid-url";
    const req = makeRequest("http://localhost:3000/callback/social");
    expect(resolvePublicOrigin(req)).toBe("http://localhost:3000");
  });
});
