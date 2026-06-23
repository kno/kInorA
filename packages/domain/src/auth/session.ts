/**
 * Session invariants — framework-free domain rules for opaque bearer tokens.
 *
 * Token generation (random bytes) and hashing (scrypt) live in the API layer
 * because they are impure infrastructure concerns. This module owns the pure
 * validation rules a session must satisfy at every boundary.
 */

/**
 * Number of random bytes used to generate a session token.
 */
export const TOKEN_BYTES = 32;

/**
 * Hex-encoded length of a session token (TOKEN_BYTES * 2).
 */
export const TOKEN_HEX_LENGTH = TOKEN_BYTES * 2;

const HEX_PATTERN = /^[0-9a-f]+$/;

/**
 * Error thrown when a session token fails the format invariant.
 */
export class InvalidSessionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSessionTokenError";
  }
}

/**
 * Returns `true` when `token` is exactly {@link TOKEN_HEX_LENGTH} lowercase
 * hex characters — the shape produced by `randomBytes(TOKEN_BYTES).toString('hex')`.
 */
export function isValidTokenFormat(token: unknown): boolean {
  return (
    typeof token === "string" &&
    token.length === TOKEN_HEX_LENGTH &&
    HEX_PATTERN.test(token)
  );
}

/**
 * Asserts that `token` satisfies {@link isValidTokenFormat}. Throws
 * {@link InvalidSessionTokenError} otherwise.
 */
export function assertValidToken(token: unknown): asserts token is string {
  if (!isValidTokenFormat(token)) {
    throw new InvalidSessionTokenError(
      `Session token must be ${TOKEN_HEX_LENGTH} lowercase hex characters`
    );
  }
}

/**
 * Returns `true` when a session has expired relative to `now`.
 *
 * A session is expired when `expiresAt` is earlier than or equal to `now` —
 * there is no grace window. Throws when `expiresAt` is null or undefined so
 * an absent expiry can never be silently treated as live.
 */
export function isSessionExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (expiresAt == null) {
    throw new Error("Session expiry check requires a non-null expiresAt timestamp");
  }
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Asserts that a session is not expired. Throws when it is.
 */
export function assertSessionNotExpired(expiresAt: Date | null | undefined, now: Date = new Date()): void {
  if (isSessionExpired(expiresAt, now)) {
    throw new Error(`Session expired at ${expiresAt!.toISOString()}`);
  }
}