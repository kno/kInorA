import { describe, it, expect, vi } from "vitest";
import { submitSignup } from "../submit-signup";

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

describe("submitSignup", () => {
  it("POSTs email+password to the API register endpoint and returns the session token on success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeJsonResponse({ jsonValue: { token: "new-session-tok" } })
      );

    const form = new FormData();
    form.append("email", "new@example.com");
    form.append("password", "securepassword");

    const result = await submitSignup(form, {
      fetchImpl,
      apiBaseUrl: "http://api.test",
    });

    expect(result).toEqual({ kind: "ok", token: "new-session-tok" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/register");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "new@example.com",
      password: "securepassword",
    });
  });

  // Triangle: missing fields
  it("returns missing_fields and does not call the API when email or password is absent", async () => {
    const fetchImpl = vi.fn();

    const noEmail = new FormData();
    noEmail.append("password", "securepassword");
    expect(await submitSignup(noEmail, { fetchImpl, apiBaseUrl: "http://api.test" })).toEqual({
      kind: "error",
      message: "missing_fields",
    });

    const noPassword = new FormData();
    noPassword.append("email", "new@example.com");
    expect(await submitSignup(noPassword, { fetchImpl, apiBaseUrl: "http://api.test" })).toEqual({
      kind: "error",
      message: "missing_fields",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Triangle: API rejects
  it("maps a non-OK API response to an error carrying the API error string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeJsonResponse({
        ok: false,
        status: 401,
        jsonValue: { error: "email_already_exists" },
      })
    );

    const form = new FormData();
    form.append("email", "existing@example.com");
    form.append("password", "securepassword");

    const result = await submitSignup(form, { fetchImpl, apiBaseUrl: "http://api.test" });
    expect(result).toEqual({ kind: "error", message: "email_already_exists" });
  });

  // Triangle: network failure
  it("returns api_unreachable when fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const form = new FormData();
    form.append("email", "new@example.com");
    form.append("password", "securepassword");

    const result = await submitSignup(form, { fetchImpl, apiBaseUrl: "http://api.test" });
    expect(result).toEqual({ kind: "error", message: "api_unreachable" });
  });

  // Triangle: 200 but no token
  it("returns no_session when the API succeeds but returns no token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeJsonResponse({ jsonValue: {} }));

    const form = new FormData();
    form.append("email", "new@example.com");
    form.append("password", "securepassword");

    const result = await submitSignup(form, { fetchImpl, apiBaseUrl: "http://api.test" });
    expect(result).toEqual({ kind: "error", message: "no_session" });
  });
});
