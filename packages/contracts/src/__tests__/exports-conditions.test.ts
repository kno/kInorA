import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the workspace "source" export-condition convention.
 *
 * A Next.js client component importing a runtime VALUE from this package
 * breaks `next dev` (Turbopack) if the package exposes its TypeScript source
 * under a condition Turbopack activates: Turbopack cannot map the source
 * barrel's NodeNext `.js` specifiers back to `.ts`. The convention:
 *
 *   - "source"  → src/*.ts   (custom; opted into ONLY by Vite/vitest via
 *                              `resolve.conditions: ["source"]`)
 *   - "types"   → src/*.ts   (type-check needs no prebuilt dist)
 *   - "default" → dist/*.js  (Turbopack and production fall through here)
 *
 * The condition MUST be "source", never "development": Turbopack activates
 * "development" in dev, which would resolve source and break the build.
 */

const packageJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    "utf8",
  ),
) as {
  exports: { ".": Record<string, string | undefined> };
};

describe("@kinora/contracts export conditions (source-condition convention)", () => {
  const root = packageJson.exports["."];

  it("resolves Vite/vitest to TypeScript source via the custom 'source' condition", () => {
    expect(root.source).toBe("./src/index.ts");
  });

  it("points 'types' at source so type-check needs no prebuilt dist", () => {
    expect(root.types).toBe("./src/index.ts");
  });

  it("falls through to prebuilt dist under 'default' (Turbopack + production)", () => {
    expect(root.default).toBe("./dist/index.js");
  });

  it("never exposes source under 'development' (Turbopack would resolve it and break)", () => {
    expect(root.development).toBeUndefined();
  });

  it("orders conditions source → types → default (first match wins)", () => {
    expect(Object.keys(root)).toEqual(["source", "types", "default"]);
  });
});
