/**
 * Emit a one-time startup warning when OPENROUTER_API_KEY is absent or blank.
 *
 * Call this ONCE at application boot (e.g. in buildApp or index.ts) — not per request.
 * Accepts an env map so it is pure-ish and trivially testable without process.env mutation.
 *
 * @param env  A record of environment variables (default: process.env)
 */
export function warnIfAiConfigMissing(env: Record<string, string | undefined> = process.env): void {
  if (!env["OPENROUTER_API_KEY"]?.trim()) {
    console.warn(
      "[startup] OPENROUTER_API_KEY is not set — AI plan generation will fail at call time"
    );
  }
}
