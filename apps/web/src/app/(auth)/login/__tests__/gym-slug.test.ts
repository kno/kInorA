import { describe, expect, it } from "vitest";
import { extractGymSlugFromHost } from "../gym-slug";

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
