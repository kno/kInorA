/**
 * Mobile social-login callback proxy.
 *
 * After the OAuth provider redirects back to the app's deep link with
 * `code` + `state`, this function proxies those params to the API
 * `POST /auth/social/callback`. On success it returns the opaque session
 * token for SecureStore persistence. On failure it returns an error message.
 *
 * Mirrors the web callback proxy (`proxySocialCallback` in PR3) but returns
 * the token for client-side storage instead of setting a cookie.
 *
 * Pure function — no React Native imports.
 */

export type MobileCallbackResult =
  | { kind: "ok"; token: string }
  | { kind: "error"; message: string };

function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

export async function proxyMobileSocialCallback(
  code: string,
  state: string,
  options: { fetchImpl?: typeof fetch; apiBaseUrl?: string } = {}
): Promise<MobileCallbackResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${base}/auth/social/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
    });
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", message: payload.error ?? "social_callback_failed" };
  }

  const session = (await res.json().catch(() => ({}))) as { token?: string };
  if (!session.token) {
    return { kind: "error", message: "no_session" };
  }

  return { kind: "ok", token: session.token };
}
