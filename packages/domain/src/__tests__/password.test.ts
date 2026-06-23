import { describe, it, expect } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
} from "@kinora/domain";

// Use a cheap scrypt cost for the test suite so the cycle stays fast while
// still exercising the real scrypt code path with non-default parameters.
const FAST = { N: 512, r: 8, p: 1, keylen: 32, saltBytes: 16 };

describe("password policy", () => {
  it("rejects a password shorter than the minimum length", () => {
    expect(() => validatePasswordPolicy("short")).toThrow(/at least|length|long/i);
  });

  it("accepts a password at the minimum length boundary", () => {
    const eight = "12345678";
    expect(validatePasswordPolicy(eight)).toBe(eight);
  });
});

describe("hashPassword / verifyPassword roundtrip", () => {
  it("produces a salted hash that verifies the original password", () => {
    const password = "correct horse battery staple";

    const hash = hashPassword(password, FAST);
    const ok = verifyPassword(password, hash);

    expect(typeof hash).toBe("string");
    expect(hash).not.toBe(password);
    expect(ok).toBe(true);
  });

  it("rejects a wrong password", () => {
    const hash = hashPassword("the-right-password", FAST);

    expect(verifyPassword("the-wrong-password", hash)).toBe(false);
  });

  it("produces a different hash for the same password (random salt)", () => {
    const password = "same-password-different-salt";

    const a = hashPassword(password, FAST);
    const b = hashPassword(password, FAST);

    expect(a).not.toBe(b);
    expect(verifyPassword(password, a)).toBe(true);
    expect(verifyPassword(password, b)).toBe(true);
  });

  // --- Triangle edge cases ---

  it("rejects an empty password before hashing", () => {
    expect(() => validatePasswordPolicy("")).toThrow();
  });

  it("hashes and verifies a very long password", () => {
    const long = "a".repeat(1000);

    const hash = hashPassword(long, FAST);

    expect(verifyPassword(long, hash)).toBe(true);
    expect(verifyPassword("a".repeat(999), hash)).toBe(false);
  });

  it("hashes and verifies a password with special characters and unicode", () => {
    const special = "Pässwörd!@#$%^&*()_+-=[]{}|;:,.<>?/`~";

    const hash = hashPassword(special, FAST);

    expect(verifyPassword(special, hash)).toBe(true);
    expect(verifyPassword("Password!@#$%^&*()_+-=[]{}|;:,.<>?/`~", hash)).toBe(false);
  });

  it("rejects verification against a malformed stored hash", () => {
    expect(verifyPassword("whatever", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("whatever", "")).toBe(false);
  });
});