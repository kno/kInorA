import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard against a dead button modifier.
 *
 * `.kin-btn--primary` was used at 24 call sites and never defined in
 * `globals.css`. Since `.kin-btn` sets `border: 1px solid transparent` and no
 * background-color, every one of those primary calls-to-action rendered with
 * no background and no border — visually identical to a secondary button.
 * Save, Create plan and Start session were all invisible as primary actions,
 * and nothing failed: not a type error, not a test, not a lint rule. CSS has
 * no compiler to tell you a class does not exist.
 *
 * This asserts the invariant directly: every `kin-btn--*` modifier written
 * anywhere in the app has a matching rule in `globals.css`. A new dead
 * modifier fails here instead of shipping.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..");
const GLOBALS = join(SRC, "app", "globals.css");

const MODIFIER = /kin-btn--([a-z0-9-]+)/g;
const SOURCE_EXT = /\.(ts|tsx)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
  return out;
}

function modifiersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(MODIFIER)) found.add(match[1]!);
  return found;
}

describe("kin-btn modifiers", () => {
  const css = readFileSync(GLOBALS, "utf8");
  const defined = modifiersIn(css);

  it("defines at least the known modifiers, so a broken read is not a silent pass", () => {
    // Without this, a globals.css that failed to load would leave `defined`
    // empty and make the assertion below vacuously true for every usage.
    expect(defined.size).toBeGreaterThanOrEqual(4);
    expect(defined.has("accent")).toBe(true);
    expect(defined.has("primary")).toBe(true);
  });

  it("has a rule in globals.css for every modifier used in the app", () => {
    const missing: string[] = [];

    for (const file of walk(SRC)) {
      if (file === GLOBALS) continue;
      for (const modifier of modifiersIn(readFileSync(file, "utf8"))) {
        if (!defined.has(modifier)) {
          missing.push(`kin-btn--${modifier} (${file.slice(SRC.length + 1)})`);
        }
      }
    }

    expect(
      missing,
      `These button modifiers are used but never defined in globals.css, so they render with no background and no border:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});
