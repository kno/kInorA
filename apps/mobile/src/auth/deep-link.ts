/**
 * Deep-link parsing and redirect-allowlist validation for mobile OAuth.
 *
 * The mobile app registers a custom URL scheme (`kinora://`) so the OAuth
 * provider can redirect back after user consent. This module provides:
 *
 * - `parseDeepLinkCallback(url)` — extracts `code` + `state` from the
 *   callback URL, validating the scheme and required params.
 * - `isAllowedRedirectUrl(url, allowlist)` — validates that the callback
 *   redirect URI matches an entry in the allowlist, preventing open-redirect
 *   attacks.
 *
 * Both are pure functions with no React Native imports — fully testable in
 * a Node environment.
 */

export interface DeepLinkCallback {
  code: string;
  state: string;
}

const KINORA_SCHEME = "kinora";

/**
 * Parse a deep-link callback URL and extract the OAuth `code` + `state`.
 * Returns `null` if the URL is invalid, uses the wrong scheme, or is
 * missing required params.
 */
export function parseDeepLinkCallback(url: string): DeepLinkCallback | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol.replace(":", "") !== KINORA_SCHEME) {
    return null;
  }

  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");

  if (!code || !state) {
    return null;
  }

  return { code, state };
}

/**
 * Validate that a redirect URL's origin + pathname matches an entry in the
 * allowlist. Query parameters in the URL are ignored for matching purposes.
 *
 * The allowlist entries are base URLs (origin + pathname) without query
 * params — e.g., `"kinora://auth/callback"`.
 */
export function isAllowedRedirectUrl(
  url: string,
  allowlist: string[]
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const candidate = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;

  return allowlist.some((allowed) => {
    let allowedParsed: URL;
    try {
      allowedParsed = new URL(allowed);
    } catch {
      return false;
    }
    const allowedBase = `${allowedParsed.protocol}//${allowedParsed.host}${allowedParsed.pathname}`;
    return candidate === allowedBase;
  });
}

/**
 * Resolve an incoming deep-link callback URL into an actionable decision.
 *
 * Composes the scheme/param validation (`parseDeepLinkCallback`) with the
 * open-redirect allowlist guard (`isAllowedRedirectUrl`): a URL is only
 * "processed" when it is a well-formed `kinora://` callback carrying both
 * `code` and `state` AND its origin+pathname is on the allowlist. Anything
 * else is ignored so the App-level handler drops it silently.
 *
 * Pure function — no React Native imports.
 */
export type DeepLinkAction =
  | { kind: "process"; code: string; state: string }
  | { kind: "ignore" };

export function resolveDeepLinkAction(
  url: string,
  allowlist: string[]
): DeepLinkAction {
  const parsed = parseDeepLinkCallback(url);
  if (!parsed) {
    return { kind: "ignore" };
  }

  if (!isAllowedRedirectUrl(url, allowlist)) {
    return { kind: "ignore" };
  }

  return { kind: "process", code: parsed.code, state: parsed.state };
}
