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
export const SESSION_COOKIE = "kinora_session";
