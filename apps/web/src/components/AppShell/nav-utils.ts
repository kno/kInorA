/**
 * Shared navigation helpers for the app shell (mobile + desktop).
 *
 * Extracted so the active-route logic lives in one place and is unit-tested
 * independently of the React components that consume it.
 */

/**
 * Check whether `pathname` matches a nav `href`, treating sub-paths as active.
 *
 * A path is active when it equals the href exactly OR begins with `href + "/"`.
 * The trailing-slash boundary prevents sibling prefixes (e.g. `/planning`)
 * from falsely activating `/plan`. The `/dashboard` root is handled by the
 * same rule.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}
