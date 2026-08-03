/**
 * Shared session cookie name for the kInorA web app.
 *
 * PR3's social callback route (`app/(auth)/callback/social/route.ts`) writes
 * the opaque bearer token issued by the API into this cookie after a
 * successful social login. The proxy reads the SAME cookie name to
 * gate protected routes. Both use the literal `kinora_session`.
 *
 * Kept in a framework-free module so proxy and route handlers can
 * share it without cross-importing each other.
 */
import { getApexHost } from "@/lib/gym-slug";

export const SESSION_COOKIE = "kinora_session";

/**
 * The destination path for all post-login redirects (login, sign-up, social
 * callback). Defined here so all three auth flows stay in sync — change this
 * one constant to reroute them all.
 */
export const POST_LOGIN_PATH = "/dashboard";

/**
 * Shared, framework-free attributes for the session cookie. Same shape whether
 * the cookie is written by the OAuth callback, the email/password login, or
 * the sign-up action — extracted here so the parent-domain logic never
 * diverges between call sites. Callers add `maxAge` (positive to set, `0` to
 * clear).
 */
export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  domain?: string;
}

/**
 * Whether the session cookie should be scoped to the PARENT domain
 * (`.<apex>`) so a session started on the apex or any gym subdomain is shared
 * across all of them — required so the post-OAuth apex→subdomain redirect does
 * not land the user logged-out.
 *
 * CRITICAL local-dev safety: only in production AND only when the apex host is
 * a real registrable domain. A `Domain=.kinora.aitsai.com` cookie served from
 * `localhost` is rejected by the browser, which would break local login — so
 * on localhost / non-production we emit a host-only cookie (no `Domain`).
 */
export function shouldUseParentDomain(apexHost: string = getApexHost()): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  const host = apexHost.trim().toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1") return false;
  // A real registrable domain has at least one dot (e.g. `kinora.aitsai.com`).
  if (!host.includes(".")) return false;
  return true;
}

/**
 * Build the session cookie attributes (minus `maxAge`), adding the parent
 * `Domain` only when {@link shouldUseParentDomain} allows it. `HttpOnly` and
 * `SameSite=Lax` are always set; `Secure` follows production.
 */
export function sessionCookieOptions(
  apexHost: string = getApexHost()
): SessionCookieOptions {
  const options: SessionCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
  if (shouldUseParentDomain(apexHost)) {
    options.domain = `.${apexHost.trim().toLowerCase()}`;
  }
  return options;
}
