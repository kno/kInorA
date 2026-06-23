import { describe, it, expect, vi } from "vitest";
import { submitLogin } from "../submit-login";

function fakeJsonResponse(init: {
  ok?: boolean;
  status?: number;
  jsonValue?: unknown;
} = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => init.jsonValue ?? {},
  } as unknown as Response;
}

describe("submitLogin", () => {
  it("POSTs email+password to the API and returns the session token on success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeJsonResponse({ jsonValue: { token: "session-tok" } })
      );

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "supersecret");

    const result = await submitLogin(form, {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "ok", token: "session-tok" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "user@example.com",
      password: "supersecret",
    });
  });

  // Triangle: missing fields → error, NO API call
  it("returns missing_fields and does not call the API when email or password is absent", async () => {
    const fetchImpl = vi.fn();

    const noEmail = new FormData();
    noEmail.append("password", "supersecret");
    expect(await submitLogin(noEmail, { fetchImpl, apiBaseUrl: "http://api.test" })).toEqual({
      kind: "error",
      message: "missing_fields",
    });

    const noPassword = new FormData();
    noPassword.append("email", "user@example.com");
    expect(await submitLogin(noPassword, { fetchImpl, apiBaseUrl: "http://api.test" })).toEqual({
      kind: "error",
      message: "missing_fields",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Triangle: API rejects → surface the API error message
  it("maps a non-OK API response to an error carrying the API error string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeJsonResponse({
        ok: false,
        status: 401,
        jsonValue: { error: "invalid_credentials" },
      })
    );

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "wrong");

    const result = await submitLogin(form, { fetchImpl, apiBaseUrl: "http://api.test" });
    expect(result).toEqual({ kind: "error", message: "invalid_credentials" });
  });

  it("falls back to a generic login_failed when the API error body has no error field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeJsonResponse({ ok: false, status: 500, jsonValue: {} })
    );

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "supersecret");

    const result = await submitLogin(form, { fetchImpl, apiBaseUrl: "http://api.test" });
    expect(result).toEqual({ kind: "error", message: "login_failed" });
  });

  // Triangle: network failure → api_unreachable
  it("returns api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "supersecret");

    const result = await submitLogin(form, { fetchImpl, apiBaseUrl: "http://api.test" });
    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  // Triangle: 200 but no token → no_session
  it("returns no_session when the API succeeds but returns no token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeJsonResponse({ jsonValue: {} }));

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "supersecret");

    const result = await submitLogin(form, { fetchImpl, apiBaseUrl: "http://api.test" });
    expect(result).toEqual({ kind: "error", message: "no_session" });
  });
});

describe("submitLogin apiBaseUrl fallback", () => {
  it("uses process.env.API_BASE_URL when set", async () => {
    const prev = process.env.API_BASE_URL;
    process.env.API_BASE_URL = "http://custom.test";
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeJsonResponse({ jsonValue: { token: "t" } }));

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "supersecret");

    await submitLogin(form, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://custom.test/auth/login",
      expect.anything()
    );
    process.env.API_BASE_URL = prev;
  });

  it("falls back to http://localhost:4000 when API_BASE_URL is not set", async () => {
    const prev = process.env.API_BASE_URL;
    delete process.env.API_BASE_URL;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeJsonResponse({ jsonValue: { token: "t" } }));

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "supersecret");

    await submitLogin(form, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:4000/auth/login",
      expect.anything()
    );
    process.env.API_BASE_URL = prev;
  });
});
