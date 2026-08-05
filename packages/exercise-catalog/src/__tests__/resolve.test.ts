/**
 * Tests for name-based catalog resolution (#352, slice-A/B foundation).
 *
 * Two things are pinned here beyond the happy path:
 *   - the tiers are EQUALITY tiers, so a title that merely shares words with a
 *     catalog name must NOT resolve. This is the property that keeps a wrong
 *     technique animation off the screen mid-workout, and it is the reason a
 *     token-overlap matcher was rejected.
 *   - the real production titles that motivated the `lenient` tier resolve,
 *     and the ones that genuinely have no catalog counterpart stay unresolved.
 */
import { describe, expect, it } from "vitest";

import {
  getExerciseById,
  listExercises,
  resolveExerciseByName,
  resolveExerciseIdByName,
  type ExerciseMatchTier,
} from "../index.js";

function tierOf(title: string): ExerciseMatchTier | undefined {
  return resolveExerciseByName(title)?.tier;
}

function nameOf(title: string): string | undefined {
  return resolveExerciseByName(title)?.record.name;
}

describe("resolveExerciseByName — exact tier", () => {
  it("resolves a catalog name verbatim", () => {
    const match = resolveExerciseByName("barbell bench press");
    expect(match?.record.name).toBe("barbell bench press");
    expect(match?.tier).toBe("exact");
  });

  it("is case- and diacritic-insensitive", () => {
    expect(tierOf("Barbell Bench Press")).toBe("exact");
    expect(nameOf("BARBELL BENCH PRESS")).toBe("barbell bench press");
  });

  it("tolerates surrounding whitespace", () => {
    expect(nameOf("  dumbbell lateral raise  ")).toBe("dumbbell lateral raise");
  });
});

describe("resolveExerciseByName — loose tier", () => {
  it("matches across punctuation differences", () => {
    // Catalog is "push-up"; a generator writing "Push Up" must still resolve.
    const match = resolveExerciseByName("Push Up");
    expect(match?.record.name).toBe("push-up");
    expect(match?.tier).toBe("loose");
  });

  it("matches a clean degree sign against an upstream mojibake name", () => {
    // Ids 0738-0740/1464 carry `в°` where `°` was meant. A correctly written
    // title must still reach them (#352 notes).
    const match = resolveExerciseByName("Sled 45° Leg Press");
    expect(match?.record.id).toBe("0739");
    expect(match?.record.name).toContain("sled 45");
    expect(match?.tier).toBe("loose");
  });

  it("still resolves the records that carry a REAL degree sign", () => {
    // The dataset is inconsistent: 0002 is `45° side bend`, with a true `°`.
    // Whatever tolerates the mojibake must not break these.
    expect(resolveExerciseByName("45° side bend")?.record.id).toBe("0002");
    expect(resolveExerciseByName("45 side bend")?.record.id).toBe("0002");
  });

  it("matches a non-breaking hyphen written by the generator", () => {
    // Real production title used U+2011 (non-breaking hyphen), not U+002D.
    expect(nameOf("Pull‑Up")).toBe("pull-up");
  });
});

describe("resolveExerciseByName — lenient tier", () => {
  it("singularizes a pluralized title", () => {
    const match = resolveExerciseByName("Push-Ups");
    expect(match?.record.name).toBe("push-up");
    expect(match?.tier).toBe("lenient");
  });

  it("drops a parenthetical prescription qualifier", () => {
    // Real production titles: "Pull-ups (Assisted if needed)",
    // "Pull-ups (Negative Focus)". The parenthetical is prescription detail the
    // catalog never carries.
    expect(nameOf("Pull-ups (Negative Focus)")).toBe("pull-up");
    expect(tierOf("Pull-ups (Assisted if needed)")).toBe("lenient");
  });

  it("singularizes -ies back to -y", () => {
    // "Cable Decline Flies" is how a generator would pluralize "cable decline
    // fly". Without the -ies rule this reaches "cable decline flie".
    expect(nameOf("Cable Decline Flies")).toBe("cable decline fly");
  });

  it("singularizes -ches/-shes/-sses to the bare stem, not to a broken one", () => {
    // "crunches" must reach "crunch", not "crunche". Same rule protects
    // "-shes" and "-sses" plurals.
    expect(nameOf("Crunches Floor")).toBe("crunch floor");
    expect(nameOf("crunch floor")).toBe("crunch floor");
  });

  it("loses a MEANINGFUL parenthetical to the unqualified record (known bound)", () => {
    // Documented limitation, pinned so it is a decision rather than a surprise:
    // the parenthetical here identifies a real catalog variant, but the plural
    // misses the exact/loose tiers, so lenient drops it and lands on the plain
    // exercise. Same movement, variant lost — and reported as `lenient`, which
    // is exactly the signal a consumer needs to reject it if that matters.
    const match = resolveExerciseByName("Push-Ups (on stability ball)");
    expect(match?.record.name).toBe("push-up");
    expect(match?.tier).toBe("lenient");

    // The singular form still reaches the variant precisely, via `exact`.
    const precise = resolveExerciseByName("push-up (on stability ball)");
    expect(precise?.record.name).toBe("push-up (on stability ball)");
    expect(precise?.tier).toBe("exact");
  });

  it("does not mangle a name ending in -ss", () => {
    // "press" must never be singularized to "pres", or every press in the
    // catalog would stop resolving.
    expect(nameOf("barbell bench press")).toBe("barbell bench press");
    expect(nameOf("Barbell Bench Presses")).toBe("barbell bench press");
  });
});

describe("resolveExerciseByName — refuses to guess", () => {
  it("returns undefined for a title that only shares words with a catalog name", () => {
    // These are the exact wrong answers a token-overlap matcher produced. A
    // band is not a bosu ball, and "standard" is precisely not the bosu
    // variant, so the correct behaviour is NO match.
    expect(resolveExerciseByName("Band-Resisted Push-Ups")).toBeUndefined();
    expect(resolveExerciseByName("Standard Push-Ups")).toBeUndefined();
    expect(resolveExerciseByName("Bulgarian Split Squat")).toBeUndefined();
    expect(resolveExerciseByName("Pull-Ups or Australian Pull-Ups")).toBeUndefined();
  });

  it("returns undefined for real production titles with no catalog counterpart", () => {
    for (const title of [
      "Resistance Band Rows",
      "Resistance Band Pull-Aparts",
      "Dumbbell Chest Press",
      "Jump Rope Intervals",
    ]) {
      expect(resolveExerciseByName(title), title).toBeUndefined();
    }
  });

  it("returns undefined for an invented movement", () => {
    expect(resolveExerciseByName("totally made up movement")).toBeUndefined();
  });

  it("returns undefined for blank, whitespace-only and non-string input", () => {
    expect(resolveExerciseByName("")).toBeUndefined();
    expect(resolveExerciseByName("   ")).toBeUndefined();
    expect(resolveExerciseByName("()")).toBeUndefined();
    expect(resolveExerciseByName(undefined as unknown as string)).toBeUndefined();
    expect(resolveExerciseByName(null as unknown as string)).toBeUndefined();
  });
});

describe("resolveExerciseByName — determinism", () => {
  it("resolves a duplicated catalog name to the lower upstream id, every time", () => {
    // "lever chest press" exists as BOTH 0576 and 0577. First-in-catalog-order
    // wins so the link is stable across processes and deploys.
    expect(resolveExerciseByName("lever chest press")?.record.id).toBe("0576");
    expect(resolveExerciseByName("Lever Chest Press")?.record.id).toBe("0576");
    expect(resolveExerciseByName("barbell seated calf raise")?.record.id).toBe("0088");
  });

  it("always returns a record that getExerciseById can retrieve", () => {
    // The id is what callers put in a `/exercises/[id]` link, so a resolved id
    // that 404s would be worse than no link.
    for (const title of ["Barbell Bench Press", "Push-Ups", "Sled 45° Leg Press"]) {
      const id = resolveExerciseIdByName(title);
      expect(id, title).toBeDefined();
      expect(getExerciseById(id!), title).toBeDefined();
    }
  });

  it("resolveExerciseIdByName agrees with resolveExerciseByName", () => {
    expect(resolveExerciseIdByName("Push-Ups")).toBe(
      resolveExerciseByName("Push-Ups")?.record.id,
    );
    expect(resolveExerciseIdByName("nope nope nope")).toBeUndefined();
  });
});

describe("resolveExerciseByName — whole-catalog invariants", () => {
  const all = listExercises().items;

  it("covers the whole catalog", () => {
    expect(all.length).toBeGreaterThan(1_300);
  });

  it("resolves EVERY catalog name back to a record", () => {
    // A normalization that mapped some record's name to an empty key, or that
    // rejected it as ambiguous at every tier, would silently make that exercise
    // unlinkable. Checked across all ~1,324 names, not a sample.
    const unresolved = all
      .filter((record) => resolveExerciseByName(record.name) === undefined)
      .map((record) => `${record.id} ${record.name}`);
    expect(unresolved).toEqual([]);
  });

  it("resolves every catalog name to ITSELF, except genuine duplicate names", () => {
    // Where a name is unique in the dataset it must resolve to that exact
    // record — never to a neighbour. The only tolerated exceptions are the six
    // records whose name is duplicated verbatim, which resolve to the lower id.
    const nameCounts = new Map<string, number>();
    for (const record of all) {
      const key = record.name.toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }

    const mismatched = all
      .filter((record) => (nameCounts.get(record.name.toLowerCase()) ?? 0) === 1)
      .filter((record) => resolveExerciseByName(record.name)?.record.id !== record.id)
      .map((record) => `${record.id} ${record.name}`);
    expect(mismatched).toEqual([]);
  });

  it("never resolves a parenthetical catalog variant from its unqualified name", () => {
    // The regression that shipped in the first draft: "Push-Ups" resolved to
    // "push-up (bosu ball)" (id 0653) because the parenthetical was stripped
    // from the catalog side too, and 0653 sorts before the plain "push-up"
    // (0662). The plain exercise must win its own name.
    expect(resolveExerciseByName("Push-Ups")?.record.id).toBe("0662");
    expect(resolveExerciseByName("push up")?.record.id).toBe("0662");
    expect(resolveExerciseByName("Pull-ups (Negative Focus)")?.record.name).toBe("pull-up");
  });
});
