import { describe, it, expect } from "vitest";
import { validateCredentials } from "../credentials";

describe("validateCredentials", () => {
  it("returns valid for a proper email and password", () => {
    const result = validateCredentials("user@example.com", "securepassword");
    expect(result).toEqual({
      valid: true,
      email: "user@example.com",
      password: "securepassword",
    });
  });

  // Triangle: empty email
  it("returns invalid when the email is empty", () => {
    const result = validateCredentials("", "securepassword");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("email");
    }
  });

  // Triangle: invalid email format
  it("returns invalid when the email format is wrong", () => {
    const result = validateCredentials("not-an-email", "securepassword");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("email");
    }
  });

  // Triangle: short password
  it("returns invalid when the password is shorter than 8 characters", () => {
    const result = validateCredentials("user@example.com", "short");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.toLowerCase()).toContain("password");
    }
  });

  // Triangle: empty password
  it("returns invalid when the password is empty", () => {
    const result = validateCredentials("user@example.com", "");
    expect(result.valid).toBe(false);
  });

  // Triangle: whitespace-only email
  it("returns invalid when the email is only whitespace", () => {
    const result = validateCredentials("   ", "securepassword");
    expect(result.valid).toBe(false);
  });
});
