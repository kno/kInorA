/**
 * Pure sign-up-submission orchestration for the web sign-up form.
 *
 * Mirrors `submit-login.ts` but POSTs to the API `POST /auth/register`
 * endpoint.  Extracted for unit-testability; the Server Action in
 * `actions.ts` wraps this.
 */

export type SignupSubmitResult =
  | { kind: "ok"; token: string }
  | { kind: "error"; message: string };

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export async function submitSignup(
  formData: FormData,
  options: { fetchImpl?: typeof fetch; apiBaseUrl?: string } = {}
): Promise<SignupSubmitResult> {
  const email = (formData.get("email") as string | null)?.trim();
  const password = formData.get("password") as string | null;

  if (!email || !password) {
    return { kind: "error", message: "missing_fields" };
  }

  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "signup_failed" };
  }

  const session = (await res.json().catch(() => ({}))) as { token?: string };
  if (!session.token) {
    return { kind: "error", message: "no_session" };
  }

  return { kind: "ok", token: session.token };
}
