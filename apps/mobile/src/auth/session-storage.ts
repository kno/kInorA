/**
 * Session storage for the mobile app using Expo SecureStore.
 *
 * Wraps SecureStore with a typed async interface so the rest of the app
 * doesn't import SecureStore directly. The decision logic (should we
 * redirect?) lives in `session-guard.ts` (pure, tested).
 */

import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "kinora_session_token";

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, token);
}

export async function deleteSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

/** Allowlist of valid deep-link redirect URLs for OAuth callback. */
export const REDIRECT_ALLOWLIST = [
  "kinora://auth/callback",
];
