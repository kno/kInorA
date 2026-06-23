/**
 * Session guard logic for mobile navigation.
 *
 * Determines whether the app should show the auth flow or the main
 * authenticated flow based on whether a session token exists in
 * SecureStore. Pure function — no React Native imports.
 */

/**
 * Resolve the initial route based on whether a session token is present.
 * Used at app startup to decide which stack to show first.
 */
export function resolveInitialRoute(hasSessionToken: boolean): string {
  return hasSessionToken ? "Home" : "Login";
}

/**
 * Determine whether navigation to a route should be blocked because
 * the user is not authenticated.
 *
 * @param routeName - The name of the target route.
 * @param hasSession - Whether the user has a valid session token.
 * @param protectedRoutes - Route names that require authentication.
 * @returns `true` if the route should be blocked (redirect to login).
 */
export function shouldGuardRoute(
  routeName: string,
  hasSession: boolean,
  protectedRoutes: string[]
): boolean {
  if (!protectedRoutes.includes(routeName)) {
    return false;
  }
  return !hasSession;
}
