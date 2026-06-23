import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { assertValidToken, TOKEN_BYTES } from "@kinora/domain";

/**
 * Session token infrastructure — API-layer concerns.
 *
 * Generation (random bytes) and hashing (scrypt) are impure infrastructure
 * concerns that live here, not in the domain package. The domain package owns
 * the pure validation invariants (`assertValidToken`, `isSessionExpired`).
 */

const SALT_BYTES = 16;
const KEYLEN = 32;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

/**
 * Generate an opaque session token: 32 random bytes encoded as lowercase hex.
 *
 * The raw token is returned to the client; only {@link hashToken} of it is stored.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/**
 * Compute a deterministic hash of a session token for DB storage and lookup.
 *
 * Uses SHA-256 because session tokens are already 256 bits of random entropy —
 * a fast hash is secure against brute-force and enables O(1) exact-match lookup
 * via the `tokenHash` unique index. The scrypt-based {@link hashToken} uses a
 * random salt and is for token *verification*, not db lookup.
 */
export function computeTokenHash(token: string): string {
  assertValidToken(token);
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Hash a session token with scrypt and a random salt for storage.
 *
 * Returns a self-describing `N:r:p:keylen:saltHex:hashHex` string so
 * {@link verifyToken} can re-derive without coupling callers to the cost config.
 */
export function hashToken(token: string): string {
  assertValidToken(token);
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(token, salt, KEYLEN, SCRYPT);
  return [SCRYPT.N, SCRYPT.r, SCRYPT.p, KEYLEN, salt.toString("hex"), hash.toString("hex")].join(":");
}

/**
 * Verify a raw token against a previously produced {@link hashToken} value.
 *
 * Re-derives the key with the embedded parameters + salt and compares in
 * constant time. Returns `false` on any structural mismatch — never throws.
 */
export function verifyToken(token: string, stored: string): boolean {
  if (typeof token !== "string" || typeof stored !== "string" || stored.length === 0) {
    return false;
  }
  const parts = stored.split(":");
  if (parts.length !== 6) {
    return false;
  }
  const [nStr, rStr, pStr, keylenStr, saltHex, hashHex] = parts;
  if (!nStr || !rStr || !pStr || !keylenStr || !saltHex || !hashHex) {
    return false;
  }
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  const keylen = Number(keylenStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || !Number.isInteger(keylen)) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== keylen) {
    return false;
  }
  let derived: Buffer;
  try {
    derived = scryptSync(token, salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}