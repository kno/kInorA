import { describe, it, expect } from "vitest";
import {
  TOKEN_BYTES,
  TOKEN_HEX_LENGTH,
  isValidTokenFormat,
  assertValidToken,
  isSessionExpired,
  assertSessionNotExpired,
} from "@kinora/domain";

describe("session token invariants", () => {
  it("accepts a 64-char lowercase hex token (32 random bytes)", () => {
    const token = "a".repeat(64);

    expect(isValidTokenFormat(token)).toBe(true);
    expect(() => assertValidToken(token)).not.toThrow();
  });

  it("exposes the expected token entropy constants", () => {
    expect(TOKEN_BYTES).toBe(32);
    expect(TOKEN_HEX_LENGTH).toBe(64);
  });

  it("rejects a token with the wrong length", () => {
    expect(isValidTokenFormat("a".repeat(63))).toBe(false);
    expect(isValidTokenFormat("a".repeat(65))).toBe(false);
    expect(() => assertValidToken("a".repeat(63))).toThrow();
  });

  it("rejects a token with non-hex characters", () => {
    expect(isValidTokenFormat("z".repeat(64))).toBe(false);
    expect(isValidTokenFormat("g".repeat(64))).toBe(false);
    expect(() => assertValidToken("z".repeat(64))).toThrow();
  });

  // --- Triangle edge cases ---

  it("rejects uppercase hex (tokens are lowercase hex from randomBytes)", () => {
    expect(isValidTokenFormat("A".repeat(64))).toBe(false);
  });

  it("rejects an empty or whitespace-only token", () => {
    expect(isValidTokenFormat("")).toBe(false);
    expect(isValidTokenFormat("   ".repeat(16))).toBe(false);
    expect(() => assertValidToken("")).toThrow();
  });
});

describe("session expiry", () => {
  it("reports an expired session when expiresAt is in the past", () => {
    const now = new Date("2026-06-22T12:00:00Z");
    const expires = new Date("2026-06-22T11:59:59Z");

    expect(isSessionExpired(expires, now)).toBe(true);
    expect(() => assertSessionNotExpired(expires, now)).toThrow(/expired/i);
  });

  it("reports a live session when expiresAt is in the future", () => {
    const now = new Date("2026-06-22T12:00:00Z");
    const expires = new Date("2026-06-22T13:00:00Z");

    expect(isSessionExpired(expires, now)).toBe(false);
    expect(() => assertSessionNotExpired(expires, now)).not.toThrow();
  });

  // --- Triangle edge cases ---

  it("treats an expiresAt equal to now as expired (no grace window)", () => {
    const now = new Date("2026-06-22T12:00:00Z");
    const expires = new Date("2026-06-22T12:00:00Z");

    expect(isSessionExpired(expires, now)).toBe(true);
  });

  it("rejects a null or undefined expiresAt", () => {
    expect(() =>
      isSessionExpired(null as unknown as Date, new Date())
    ).toThrow();
    expect(() =>
      assertSessionNotExpired(undefined as unknown as Date, new Date())
    ).toThrow();
  });
});