import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Next.js `redirect()` throws a special NEXT_REDIRECT error to abort the
 * response. Simulate that here so Server Action control-flow is correct
 * under test (without the throw, both the error redirect and the success
 * redirect would fire in a single action invocation).
 */
class NextRedirectError extends Error {
  readonly destination: string;
  constructor(destination: string) {
    super("NEXT_REDIRECT");
    this.destination = destination;
  }
}

const { jarSetMock, submitLoginMock } = vi.hoisted(() => ({
  jarSetMock: vi.fn(),
  submitLoginMock: vi.fn(),
}));

// redirect throws like the real Next.js implementation so actions abort.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new NextRedirectError(path);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: jarSetMock })),
}));
vi.mock("../submit-login", () => ({ submitLogin: submitLoginMock }));

import { loginAction } from "../actions";
import { redirect } from "next/navigation";

describe("loginAction", () => {
  beforeEach(() => {
    jarSetMock.mockClear();
    submitLoginMock.mockClear();
    vi.mocked(redirect).mockClear();
  });

  it("redirects to /dashboard on successful login", async () => {
    submitLoginMock.mockResolvedValue({ kind: "ok", token: "tok" });

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "secret");

    await expect(loginAction(form)).rejects.toThrow("NEXT_REDIRECT");
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/dashboard");
    expect(vi.mocked(redirect)).not.toHaveBeenCalledWith(expect.stringContaining("login"));
  });

  it("sets the session cookie before redirecting on success", async () => {
    submitLoginMock.mockResolvedValue({ kind: "ok", token: "my-tok" });

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "secret");

    await expect(loginAction(form)).rejects.toThrow("NEXT_REDIRECT");

    expect(jarSetMock).toHaveBeenCalledWith(
      "kinora_session",
      "my-tok",
      expect.objectContaining({ httpOnly: true })
    );
  });

  it("redirects to /login with the error on failure (not /dashboard)", async () => {
    submitLoginMock.mockResolvedValue({
      kind: "error",
      message: "invalid_credentials",
    });

    const form = new FormData();
    form.append("email", "user@example.com");
    form.append("password", "wrong");

    await expect(loginAction(form)).rejects.toThrow("NEXT_REDIRECT");

    expect(vi.mocked(redirect)).toHaveBeenCalledWith(
      "/login?error=invalid_credentials"
    );
    expect(vi.mocked(redirect)).not.toHaveBeenCalledWith("/dashboard");
  });
});
