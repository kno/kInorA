/**
 * Unit tests for the capability guard (`scripts/deps-guard.mjs`).
 *
 * The guard is only worth its exit code if it fails when it should, and until
 * now nothing proved it did. These tests drive the classification directly:
 * each capability category is checked from a workspace that may hold it and one
 * that may not, so a broken pattern or a mistaken allowlist shows up as a red
 * test rather than as a package that quietly stops being guarded.
 *
 * `packages/i18n` appears throughout on purpose — it is the package the old
 * hardcoded list forgot, so it is now the standard example of "a workspace with
 * no special permissions".
 *
 * The module is guarded by an `isMain` check, so importing it here runs no
 * discovery and shells out to nothing.
 *
 * Layers used: Unit (no runtime boundary).
 */
import { describe, expect, it } from "vitest";

import {
  collectDependencies,
  describeDiscoveryMismatch,
  findViolations,
  isAllowedWorkspace,
} from "../deps-guard.mjs";

describe("collectDependencies", () => {
  it("reads runtime, dev and peer dependencies", () => {
    expect(
      collectDependencies({
        dependencies: { zod: "^4" },
        devDependencies: { vitest: "3.2.4" },
        peerDependencies: { react: "^19" },
      }),
    ).toEqual(["zod", "vitest", "react"]);
  });

  it("tolerates a package.json with no dependency fields at all", () => {
    expect(collectDependencies({})).toEqual([]);
  });
});

describe("isAllowedWorkspace", () => {
  it("matches the exact root-relative directory", () => {
    expect(isAllowedWorkspace("apps/api", ["apps/api"])).toBe(true);
    expect(isAllowedWorkspace("packages/i18n", ["apps/api"])).toBe(false);
  });

  it("does not exempt a directory that merely starts with an allowed one", () => {
    // The previous implementation compared with `filepath.includes(...)`, which
    // would have granted `apps/api-legacy` every permission `apps/api` holds.
    expect(isAllowedWorkspace("apps/api-legacy", ["apps/api"])).toBe(false);
  });

  it("treats the workspace root as its own directory, not as a prefix of others", () => {
    expect(isAllowedWorkspace(".", ["apps/mobile", "."])).toBe(true);
    expect(isAllowedWorkspace("apps/web", ["apps/mobile", "."])).toBe(false);
  });
});

describe("findViolations", () => {
  it("reports nothing for an ordinary toolchain dependency anywhere", () => {
    expect(findViolations("packages/i18n", ["typescript", "vitest", "@types/node"])).toEqual(
      [],
    );
  });

  describe("database packages — apps/api only", () => {
    it("allows them in apps/api", () => {
      expect(findViolations("apps/api", ["pg", "drizzle-orm"])).toEqual([]);
    });

    it("rejects them in every other workspace, including the root", () => {
      expect(findViolations("packages/i18n", ["drizzle-orm"])).toEqual(["drizzle-orm"]);
      expect(findViolations("apps/web", ["pg"])).toEqual(["pg"]);
      expect(findViolations(".", ["prisma"])).toEqual(["prisma"]);
    });
  });

  describe("AI/LLM packages — apps/api only", () => {
    it("allows them in apps/api", () => {
      expect(findViolations("apps/api", ["openai", "@langchain/core", "langfuse-langchain"])).toEqual(
        [],
      );
    });

    it("rejects them in the inner layers, which must stay network-free", () => {
      expect(findViolations("packages/domain", ["openai"])).toEqual(["openai"]);
      expect(findViolations("packages/i18n", ["@langchain/core"])).toEqual(["@langchain/core"]);
    });
  });

  describe("Stripe — apps/api only", () => {
    it("allows the SDK in apps/api and rejects it elsewhere", () => {
      expect(findViolations("apps/api", ["stripe"])).toEqual([]);
      expect(findViolations("apps/web", ["stripe"])).toEqual(["stripe"]);
    });

    it("is anchored, so an unrelated package merely containing the word passes", () => {
      expect(findViolations("apps/web", ["stripe-like-ui"])).toEqual([]);
    });
  });

  describe("PWA packages — apps/web only", () => {
    it("allows them in apps/web and rejects them elsewhere", () => {
      expect(findViolations("apps/web", ["@serwist/next", "serwist"])).toEqual([]);
      expect(findViolations("apps/mobile", ["workbox-window"])).toEqual(["workbox-window"]);
    });
  });

  describe("Capacitor packages — root and apps/mobile only", () => {
    it("allows the native shell at the root and in apps/mobile", () => {
      expect(findViolations(".", ["@capacitor/core", "@capacitor/android"])).toEqual([]);
      expect(findViolations("apps/mobile", ["@capacitor/core"])).toEqual([]);
    });

    it("rejects them in apps/web and in the packages", () => {
      expect(findViolations("apps/web", ["@capacitor/core"])).toEqual(["@capacitor/core"]);
      expect(findViolations("packages/i18n", ["@capacitor/core"])).toEqual(["@capacitor/core"]);
    });
  });

  describe("globally prohibited packages", () => {
    it("rejects auth, Docker and CI packages in every workspace without exception", () => {
      for (const dir of [".", "apps/api", "apps/web", "apps/mobile", "packages/i18n"]) {
        expect(findViolations(dir, ["next-auth"])).toEqual(["next-auth"]);
        expect(findViolations(dir, ["bcrypt"])).toEqual(["bcrypt"]);
        expect(findViolations(dir, ["dockerode"])).toEqual(["dockerode"]);
      }
    });

    it("is not softened by a workspace's other permissions", () => {
      // apps/api may hold database and AI packages; that must not extend to a
      // category whose allowlist is empty.
      expect(findViolations("apps/api", ["passport"])).toEqual(["passport"]);
    });
  });

  it("reports a dependency once even when several categories forbid it", () => {
    // `oauth2-pg-store` matches both the global auth patterns and the database
    // patterns. The old implementation pushed it once per category.
    expect(findViolations("apps/web", ["oauth2-pg-store"])).toEqual(["oauth2-pg-store"]);
  });

  it("lists every offending dependency, not just the first", () => {
    expect(findViolations("packages/i18n", ["drizzle-orm", "typescript", "openai"])).toEqual([
      "drizzle-orm",
      "openai",
    ]);
  });
});

describe("describeDiscoveryMismatch", () => {
  it("names a package pnpm resolves that discovery missed", () => {
    const message = describeDiscoveryMismatch({
      missedByGuard: ["packages/i18n"],
      unknownToPnpm: [],
    });
    expect(message).toContain("pnpm resolves these workspace projects");
    expect(message).toContain("packages/i18n");
    expect(message).not.toContain("does not treat as workspace projects");
  });

  it("names a directory pnpm does not recognise", () => {
    const message = describeDiscoveryMismatch({
      missedByGuard: [],
      unknownToPnpm: ["packages/ghost"],
    });
    expect(message).toContain("does not treat as workspace projects");
    expect(message).toContain("packages/ghost");
  });

  it("reports both directions together when both differ", () => {
    const message = describeDiscoveryMismatch({
      missedByGuard: ["packages/i18n"],
      unknownToPnpm: ["packages/ghost"],
    });
    expect(message).toContain("packages/i18n");
    expect(message).toContain("packages/ghost");
  });
});
