import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Minimum password length enforced by the auth domain policy.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Error thrown when a password fails the domain policy before hashing.
 */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export interface ScryptOptions {
  /** CPU/memory cost — must be a power of 2. Defaults to 2^14 (OWASP). */
  N?: number;
  /** Block size. */
  r?: number;
  /** Parallelization. */
  p?: number;
  /** Maximum memory in bytes for scrypt. */
  maxmem?: number;
  /** Derived key length in bytes. */
  keylen?: number;
  /** Salt length in bytes. */
  saltBytes?: number;
}

const DEFAULT_SCRYPT: Required<ScryptOptions> = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 128 * 1024 * 1024,
  keylen: 32,
  saltBytes: 16,
};

/**
 * Validate a password against the domain policy.
 *
 * Throws {@link PasswordPolicyError} when the password is absent or shorter
 * than {@link MIN_PASSWORD_LENGTH}. Returns the password unchanged on success
 * so callers can use it inline: `hashPassword(validatePasswordPolicy(input))`.
 */
export function validatePasswordPolicy(password: string): string {
  if (typeof password !== "string" || password.length === 0) {
    throw new PasswordPolicyError("Password is required: value must be a non-empty string");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long (got ${password.length})`
    );
  }
  return password;
}

function resolveOptions(opts?: ScryptOptions): Required<ScryptOptions> {
  return { ...DEFAULT_SCRYPT, ...opts };
}

/**
 * Hash a password with scrypt and a random salt.
 *
 * Returns a self-describing string `N:r:p:keylen:saltHex:hashHex` so
 * {@link verifyPassword} can re-derive the key with the exact same parameters
 * without coupling callers to the cost configuration.
 */
export function hashPassword(password: string, opts?: ScryptOptions): string {
  const o = resolveOptions(opts);
  const salt = randomBytes(o.saltBytes);
  const hash = scryptSync(password, salt, o.keylen, {
    N: o.N,
    r: o.r,
    p: o.p,
    maxmem: o.maxmem,
  });
  return [o.N, o.r, o.p, o.keylen, salt.toString("hex"), hash.toString("hex")].join(":");
}

/**
 * Verify a password against a previously produced {@link hashPassword} value.
 *
 * Re-derives the key using the parameters and salt embedded in `stored`, then
 * compares in constant time with {@link timingSafeEqual}. Returns `false` on any
 * structural mismatch (malformed stored value, wrong password) — never throws.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof password !== "string" || typeof stored !== "string" || stored.length === 0) {
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
    derived = scryptSync(password, salt, keylen, { N, r, p, maxmem: DEFAULT_SCRYPT.maxmem });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}