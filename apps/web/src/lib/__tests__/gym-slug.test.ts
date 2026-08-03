import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_APEX_HOST,
  extractGymSlugFromHost,
  getApexHost,
  sanitizeGymSlug,
} from "../gym-slug";

/**
 * 16a-v3-gym-white-label, Slice 4 (task 4.1's parsing edge cases, pulled
 * into its own unit-tested pure function per the design's host→slug
 * resolution requirement). No Next.js/server API dependency — pure string
 * parsing, unit-tested in isolation from the login page's RSC rendering.
 */
describe("extractGymSlugFromHost", () => {
  it("extracts the subdomain slug from a gym host", () => {
    expect(extractGymSlugFromHost("gymname.kinora.aitsai.com")).toBe("gymname");
  });

  it("keeps working when the host carries a port", () => {
    expect(extractGymSlugFromHost("gymname.kinora.aitsai.com:3000")).toBe("gymname");
  });

  it("returns null for the bare apex domain", () => {
    expect(extractGymSlugFromHost("kinora.aitsai.com")).toBeNull();
  });

  it("returns null for the www subdomain", () => {
    expect(extractGymSlugFromHost("www.kinora.aitsai.com")).toBeNull();
  });

  it("returns null for localhost (with or without a port)", () => {
    expect(extractGymSlugFromHost("localhost")).toBeNull();
    expect(extractGymSlugFromHost("localhost:3000")).toBeNull();
  });

  it("returns null for an unrelated host", () => {
    expect(extractGymSlugFromHost("example.com")).toBeNull();
  });

  it("returns null for a multi-level subdomain (only one label supported)", () => {
    expect(extractGymSlugFromHost("sub.gymname.kinora.aitsai.com")).toBeNull();
  });

  it("returns null for a missing/empty host", () => {
    expect(extractGymSlugFromHost(null)).toBeNull();
    expect(extractGymSlugFromHost(undefined)).toBeNull();
    expect(extractGymSlugFromHost("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractGymSlugFromHost("GymName.KINORA.AITSAI.COM")).toBe("gymname");
  });
});

describe("getApexHost", () => {
  const envKey = "NEXT_PUBLIC_APEX_HOST";

  afterEach(() => {
    delete process.env[envKey];
  });

  it("returns the default apex host when the env var is unset", () => {
    delete process.env[envKey];
    expect(getApexHost()).toBe(DEFAULT_APEX_HOST);
  });

  it("honors and lowercases NEXT_PUBLIC_APEX_HOST when set", () => {
    process.env[envKey] = "Staging.KINORA.AITSAI.COM";
    expect(getApexHost()).toBe("staging.kinora.aitsai.com");
  });
});

describe("sanitizeGymSlug (open-redirect guard)", () => {
  it("accepts and normalizes a valid single-label slug", () => {
    expect(sanitizeGymSlug("downtown")).toBe("downtown");
    expect(sanitizeGymSlug("  Downtown  ")).toBe("downtown");
    expect(sanitizeGymSlug("gym-01")).toBe("gym-01");
  });

  it("rejects a full host with a dot (evil.com)", () => {
    expect(sanitizeGymSlug("evil.com")).toBeNull();
  });

  it("rejects multi-label values (a.b)", () => {
    expect(sanitizeGymSlug("a.b")).toBeNull();
  });

  it("rejects path-traversal (../)", () => {
    expect(sanitizeGymSlug("../")).toBeNull();
  });

  it("rejects protocol-relative prefixes (//evil)", () => {
    expect(sanitizeGymSlug("//evil")).toBeNull();
    expect(sanitizeGymSlug("evil/path")).toBeNull();
  });

  it("rejects the www alias", () => {
    expect(sanitizeGymSlug("www")).toBeNull();
  });

  it("rejects empty / nullish / whitespace-only input", () => {
    expect(sanitizeGymSlug(null)).toBeNull();
    expect(sanitizeGymSlug(undefined)).toBeNull();
    expect(sanitizeGymSlug("")).toBeNull();
    expect(sanitizeGymSlug("   ")).toBeNull();
  });

  it("rejects a label longer than 63 chars", () => {
    expect(sanitizeGymSlug("a".repeat(64))).toBeNull();
    expect(sanitizeGymSlug("a".repeat(63))).toBe("a".repeat(63));
  });

  it("rejects a full URL", () => {
    expect(sanitizeGymSlug("https://evil.com")).toBeNull();
  });
});
