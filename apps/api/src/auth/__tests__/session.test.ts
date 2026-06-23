import { describe, it, expect } from "vitest";
import { generateToken, hashToken, verifyToken } from "../session.js";
import { isValidTokenFormat } from "@kinora/domain";

describe("session token infrastructure", () => {
  it("generates a 64-char lowercase hex token from 32 random bytes", () => {
    const token = generateToken();

    expect(token).toHaveLength(64);
    expect(isValidTokenFormat(token)).toBe(true);
  });

  it("generates a fresh token on every call (randomness)", () => {
    const a = generateToken();
    const b = generateToken();

    expect(a).not.toBe(b);
  });

  it("hashes a token to a salted value that is not the token", () => {
    const token = generateToken();
    const hash = hashToken(token);

    expect(typeof hash).toBe("string");
    expect(hash).not.toBe(token);
    expect(hash).toContain(":");
  });

  it("verifies the original token against its hash", () => {
    const token = generateToken();
    const hash = hashToken(token);

    expect(verifyToken(token, hash)).toBe(true);
  });

  it("rejects a wrong token against a valid hash", () => {
    const token = generateToken();
    const hash = hashToken(token);
    const other = generateToken();

    expect(verifyToken(other, hash)).toBe(false);
  });

  // --- Triangle edge cases ---

  it("produces a different hash for the same token (random salt)", () => {
    const token = "a".repeat(64);

    const a = hashToken(token);
    const b = hashToken(token);

    expect(a).not.toBe(b);
    expect(verifyToken(token, a)).toBe(true);
    expect(verifyToken(token, b)).toBe(true);
  });

  it("rejects verification against a malformed stored hash", () => {
    expect(verifyToken("a".repeat(64), "")).toBe(false);
    expect(verifyToken("a".repeat(64), "not-a-valid-hash")).toBe(false);
  });
});