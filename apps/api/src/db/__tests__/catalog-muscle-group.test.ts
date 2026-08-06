import { describe, expect, it } from "vitest";
import { listExercises } from "@kinora/exercise-catalog";
import { MUSCLE_GROUPS } from "@kinora/contracts";
import { classifyExerciseMuscleGroup } from "../muscle-classifier.js";
import {
  CATALOG_TARGET_MUSCLE_GROUPS,
  UNMAPPED_CATALOG_TARGETS,
  deriveExerciseMuscleGroup,
  muscleGroupFromCatalogRecord,
} from "../catalog-muscle-group.js";

/**
 * #352 slice C — deriving `session_exercises.muscle_group` from the catalog's
 * taxonomy instead of keyword-matching the free-text title.
 *
 * These tests read the LIVE dataset (no fixtures): the map is a claim about
 * `packages/exercise-catalog/data/exercises.catalog.json`, so a fixture would
 * only prove the map agrees with itself.
 */

/** Every record in the catalog — `listExercises()` with no filters is total. */
const allRecords = listExercises().items;
const distinctTargets = [...new Set(allRecords.map((record) => record.target))].sort();

describe("catalog target -> MuscleGroup map (#352 slice C)", () => {
  it("accounts for EVERY distinct target in the catalog, with no catch-all", () => {
    // THE test of this slice. A target that is neither mapped nor explicitly
    // written off is a silent `null` in the muscle-group distribution, so the
    // map is not allowed to be partial: when a dataset refresh introduces a
    // target, this fails and somebody decides where it belongs.
    const unaccounted = distinctTargets.filter(
      (target) =>
        CATALOG_TARGET_MUSCLE_GROUPS[target] === undefined &&
        !UNMAPPED_CATALOG_TARGETS.has(target),
    );

    expect(unaccounted).toEqual([]);
  });

  it("has no entry for a target the catalog no longer contains", () => {
    // The other direction: a stale key is a decision about data that is gone,
    // and it hides the fact that the target it used to cover has vanished.
    const known = new Set(distinctTargets);
    const stale = [
      ...Object.keys(CATALOG_TARGET_MUSCLE_GROUPS),
      ...UNMAPPED_CATALOG_TARGETS,
    ].filter((target) => !known.has(target));

    expect(stale.sort()).toEqual([]);
  });

  it("never maps a target to something outside the ten MuscleGroup buckets", () => {
    // `Record<string, MuscleGroup>` is compile-time only; the DB column is a
    // plain varchar, so a wrong value would be persisted without complaint.
    const buckets = new Set<string>(MUSCLE_GROUPS);

    for (const group of Object.values(CATALOG_TARGET_MUSCLE_GROUPS)) {
      expect(buckets.has(group)).toBe(true);
    }
  });

  it("classifies a target as mapped OR unmapped, never both", () => {
    const overlap = Object.keys(CATALOG_TARGET_MUSCLE_GROUPS).filter((target) =>
      UNMAPPED_CATALOG_TARGETS.has(target),
    );

    expect(overlap).toEqual([]);
  });

  it("pins the premise that made `bodyPart` unnecessary at runtime: one bodyPart per target", () => {
    // The map reads `target` alone. That is only sound because each target
    // occurs under exactly one `bodyPart` in this dataset — `bodyPart` decided
    // the ambiguous entries when the map was authored and can add nothing at
    // runtime. If a refresh breaks this, the map needs a bodyPart tiebreak and
    // this is where we find out.
    const bodyPartsByTarget = new Map<string, Set<string>>();
    for (const record of allRecords) {
      const seen = bodyPartsByTarget.get(record.target) ?? new Set<string>();
      seen.add(record.bodyPart);
      bodyPartsByTarget.set(record.target, seen);
    }

    const multiBodyPart = [...bodyPartsByTarget.entries()]
      .filter(([, bodyParts]) => bodyParts.size > 1)
      .map(([target]) => target);

    expect(multiBodyPart).toEqual([]);
  });

  it("documents the intentionally unmapped targets and why they have no bucket", () => {
    // Pinned as a literal so shrinking the gap (or widening it) is a visible,
    // reviewed edit rather than a side effect of touching the map.
    expect([...UNMAPPED_CATALOG_TARGETS].sort()).toEqual([
      "adductors", // inner thigh: not quads, not hamstrings, not glutes
      "cardiovascular system", // cardio has no muscle-group slice
      "forearms", // taxonomy stops at biceps/triceps
      "levator scapulae", // neck
    ]);
  });

  it("leaves under 6% of the catalog without a bucket", () => {
    // A guard on the map's usefulness, not on the exact number: if a refresh
    // ever pushed most of the dataset into the unmapped set the derivation
    // would quietly degrade to the old classifier everywhere.
    const unmappedRecords = allRecords.filter(
      (record) => muscleGroupFromCatalogRecord(record) === null,
    );

    expect(unmappedRecords.length / allRecords.length).toBeLessThan(0.06);
  });
});

describe("muscleGroupFromCatalogRecord (#352 slice C)", () => {
  it("returns the mapped bucket for a mapped target", () => {
    const record = allRecords.find((candidate) => candidate.target === "pectorals");

    expect(record && muscleGroupFromCatalogRecord(record)).toBe("chest");
  });

  it("returns null for an intentionally unmapped target", () => {
    const record = allRecords.find(
      (candidate) => candidate.target === "cardiovascular system",
    );

    expect(record && muscleGroupFromCatalogRecord(record)).toBeNull();
  });
});

describe("deriveExerciseMuscleGroup (#352 slice C)", () => {
  it("prefers the catalog over the classifier, and they really do disagree", () => {
    // The disagreement IS the slice. Close-grip bench is a triceps movement
    // that the keyword classifier files under chest because the title contains
    // "bench press"; the catalog records its target as `triceps`. Asserting
    // the classifier's old answer here keeps the example honest — if the
    // classifier ever changes its mind this stops being a valid pin.
    const title = "Barbell Close-Grip Bench Press";

    expect(classifyExerciseMuscleGroup(title)).toBe("chest");
    expect(deriveExerciseMuscleGroup({ name: title })).toBe("triceps");
  });

  it("answers where the classifier had no keyword at all", () => {
    expect(classifyExerciseMuscleGroup("Hyperextension")).toBeNull();
    expect(deriveExerciseMuscleGroup({ name: "Hyperextension" })).toBe("back");
  });

  it("falls back to the classifier, unchanged, for a title the catalog cannot resolve", () => {
    // The generator's vocabulary is not the catalog's, so this is the common
    // case in production. It must produce exactly what it produced before.
    for (const title of ["Bench Press", "Chest Supported Row", "Resistance Band Rows"]) {
      expect(deriveExerciseMuscleGroup({ name: title })).toBe(
        classifyExerciseMuscleGroup(title),
      );
    }

    expect(deriveExerciseMuscleGroup({ name: "Resistance Band Rows" })).toBe("back");
  });

  it("still degrades to null when neither the catalog nor the classifier knows", () => {
    expect(deriveExerciseMuscleGroup({ name: "Zorbatron Flux Capacitor Drill" })).toBeNull();
  });

  it("falls back to the classifier when the resolved record's target is unmapped", () => {
    // "cable wrist curl" is a real catalog record whose target (`forearms`) has
    // no bucket. Resolving must not make the answer WORSE than not resolving:
    // the classifier's bare "curl" -> biceps still stands.
    expect(deriveExerciseMuscleGroup({ name: "cable wrist curl" })).toBe("biceps");
  });

  it("prefers a stored catalogId over re-resolving the name", () => {
    // Slice B resolves the id server-side against the user's own equipment
    // vocabulary; `plan/catalog-links.ts` treats that stored id as final for
    // the same reason. `0030` is "barbell close-grip bench press" (triceps),
    // while the name on its own resolves to nothing and would fall through to
    // the classifier's `chest`.
    expect(
      deriveExerciseMuscleGroup({ name: "Bench Press", catalogId: "0030" }),
    ).toBe("triceps");
  });

  it("ignores an unknown catalogId rather than failing on it", () => {
    expect(
      deriveExerciseMuscleGroup({ name: "Bench Press", catalogId: "no-such-id" }),
    ).toBe("chest");
  });

  it("reads the name and nothing else — the prescription snapshot is untouched", () => {
    // The derivation is a read. This pins that it cannot mutate the object the
    // repository is about to write `title` from.
    const exercise = { name: "Barbell Close-Grip Bench Press", catalogId: "0030" };
    const frozen = Object.freeze({ ...exercise });

    expect(deriveExerciseMuscleGroup(frozen)).toBe("triceps");
    expect(frozen).toEqual(exercise);
  });
});
