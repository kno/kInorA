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

const { jarSetMock, submitSignupMock } = vi.hoisted(() => ({
  jarSetMock: vi.fn(),
  submitSignupMock: vi.fn(),
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
vi.mock("../submit-signup", () => ({ submitSignup: submitSignupMock }));

import { signupAction } from "../actions";
import { redirect } from "next/navigation";

describe("signupAction", () => {
  beforeEach(() => {
    jarSetMock.mockClear();
    submitSignupMock.mockClear();
    vi.mocked(redirect).mockClear();
  });

  it("redirects to /dashboard on successful sign-up", async () => {
    submitSignupMock.mockResolvedValue({ kind: "ok", token: "new-tok" });

    const form = new FormData();
    form.append("email", "new@example.com");
    form.append("password", "securepassword");

    await expect(signupAction(form)).rejects.toThrow("NEXT_REDIRECT");
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/dashboard");
    expect(vi.mocked(redirect)).not.toHaveBeenCalledWith(expect.stringContaining("sign-up"));
  });

  it("sets the session cookie before redirecting on success", async () => {
    submitSignupMock.mockResolvedValue({ kind: "ok", token: "new-tok" });

    const form = new FormData();
    form.append("email", "new@example.com");
    form.append("password", "securepassword");

    await expect(signupAction(form)).rejects.toThrow("NEXT_REDIRECT");

    expect(jarSetMock).toHaveBeenCalledWith(
      "kinora_session",
      "new-tok",
      expect.objectContaining({ httpOnly: true })
    );
  });

  it("redirects to /sign-up with the error on failure (not /dashboard)", async () => {
    submitSignupMock.mockResolvedValue({
      kind: "error",
      message: "email_already_exists",
    });

    const form = new FormData();
    form.append("email", "existing@example.com");
    form.append("password", "securepassword");

    await expect(signupAction(form)).rejects.toThrow("NEXT_REDIRECT");

    expect(vi.mocked(redirect)).toHaveBeenCalledWith(
      "/sign-up?error=email_already_exists"
    );
    expect(vi.mocked(redirect)).not.toHaveBeenCalledWith("/dashboard");
  });
});
