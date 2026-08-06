/**
 * Tests for the wizard-equipment → catalog-exercise bridge (#352 slice B).
 *
 * The property that matters is NEGATIVE: the vocabulary must never contain an
 * exercise the user cannot physically perform. A vocabulary that is too small
 * costs variety; one that is too large reintroduces the bug this slice exists
 * to fix, and does it invisibly, inside a generated plan.
 */
import { describe, expect, it } from "vitest";

import {
  KNOWN_EQUIPMENT_VALUES,
  resolveExerciseVocabulary,
} from "../exercise-vocabulary.js";

function equipmentOf(equipment: string[]): Set<string> {
  return new Set(resolveExerciseVocabulary(equipment).exercises.map((e) => e.equipment));
}

function names(equipment: string[]): string[] {
  return resolveExerciseVocabulary(equipment).exercises.map((e) => e.name);
}

describe("resolveExerciseVocabulary — bodyweight is the floor", () => {
  it("returns bodyweight exercises even when nothing was selected", () => {
    const { exercises } = resolveExerciseVocabulary([]);
    expect(exercises.length).toBeGreaterThan(200);
    expect(equipmentOf([])).toEqual(new Set(["body weight"]));
  });

  it("treats absent equipment the same as an empty list", () => {
    expect(resolveExerciseVocabulary().exercises.length).toBe(
      resolveExerciseVocabulary([]).exercises.length,
    );
  });

  it("keeps bodyweight available for someone who only selected dumbbells", () => {
    // Otherwise a dumbbell-only plan would contain no bodyweight movement at
    // all, which is not what the user asked for.
    expect(equipmentOf(["dumbbells"])).toEqual(new Set(["body weight", "dumbbell"]));
  });
});

describe("resolveExerciseVocabulary — the gaps the catalog cannot express", () => {
  it("excludes pull-ups when there is no pull-up bar", () => {
    const withoutBar = names([]);
    expect(withoutBar.some((n) => /pull-?up|chin-?up/i.test(n))).toBe(false);
    // ...and the bodyweight catalog is otherwise intact.
    expect(withoutBar.length).toBeGreaterThan(250);
  });

  it("includes them once a pull-up bar is declared", () => {
    const withBar = names(["pull_up_bar"]);
    expect(withBar.some((n) => /pull-?up/i.test(n))).toBe(true);
    expect(withBar.length).toBeGreaterThan(names([]).length);
  });

  it("excludes hanging work without a bar — it needs the same bar a pull-up does", () => {
    // "hanging leg raise" says nothing about pulling, but you still have to
    // hang from something.
    expect(names([]).some((n) => /hanging/i.test(n))).toBe(false);
    expect(names(["pull_up_bar"]).some((n) => /hanging/i.test(n))).toBe(true);
  });

  it("excludes bench work without a bench, across every equipment family", () => {
    // "bench" is spread over eight equipment values, so this cannot be done by
    // filtering the equipment field.
    const gymNoBench = names(["barbell", "dumbbells", "cable_machine"]);
    expect(gymNoBench.some((n) => /\bbench\b/i.test(n))).toBe(false);
    expect(gymNoBench.some((n) => n === "barbell bench press")).toBe(false);
  });

  it("includes bench work once a bench is declared", () => {
    const withBench = names(["barbell", "bench"]);
    expect(withBench).toContain("barbell bench press");
  });

  it("does NOT report pull_up_bar or bench as ignored — they act via name rules", () => {
    // They unlock nothing in the equipment table, but pull_up_bar adds 33
    // exercises and bench adds 72. Reporting them as ignored would be false.
    expect(resolveExerciseVocabulary(["pull_up_bar"]).ignoredEquipment).toEqual([]);
    expect(resolveExerciseVocabulary(["bench"]).ignoredEquipment).toEqual([]);
  });

  it("reports suspension_trainer as ignored — the catalog has no such records", () => {
    const { ignoredEquipment, exercises } = resolveExerciseVocabulary(["suspension_trainer"]);
    expect(ignoredEquipment).toEqual(["suspension_trainer"]);
    // It grants nothing, so the vocabulary is exactly the bodyweight floor.
    expect(exercises.length).toBe(resolveExerciseVocabulary([]).exercises.length);
  });
});

describe("resolveExerciseVocabulary — mapping the values that do line up", () => {
  it("unlocks the whole barbell family from one wizard answer", () => {
    // A user who owns "a barbell" can use the ez/olympic/trap variants too.
    const eq = equipmentOf(["barbell"]);
    expect(eq).toContain("barbell");
    expect(eq).toContain("ez barbell");
    expect(eq).toContain("olympic barbell");
  });

  it("unlocks BOTH catalog spellings of a resistance band", () => {
    // The catalog carries `band` and `resistance band` for the same object.
    const eq = equipmentOf(["resistance_bands"]);
    expect(eq).toContain("band");
    expect(eq).toContain("resistance band");
  });

  it("maps leg_press onto the machine families that actually hold those records", () => {
    const eq = equipmentOf(["leg_press"]);
    expect(eq).toContain("sled machine");
    expect(eq).toContain("leverage machine");
  });

  it("never leaks equipment the user did not declare", () => {
    // The core negative property, checked over a realistic home setup.
    const eq = equipmentOf(["dumbbells", "resistance_bands"]);
    expect(eq).toEqual(new Set(["body weight", "dumbbell", "band", "resistance band"]));
    for (const forbidden of ["barbell", "cable", "smith machine", "leverage machine"]) {
      expect(eq.has(forbidden), forbidden).toBe(false);
    }
  });
});

describe("resolveExerciseVocabulary — robustness on the generation path", () => {
  it("reports an unknown wizard value as ignored instead of throwing", () => {
    // A new wizard option shipped without updating the table must degrade to
    // "grants nothing", never crash plan generation.
    const { ignoredEquipment, exercises } = resolveExerciseVocabulary(["jetpack"]);
    expect(ignoredEquipment).toEqual(["jetpack"]);
    expect(exercises.length).toBe(resolveExerciseVocabulary([]).exercises.length);
  });

  it("tolerates duplicates, blanks and non-strings", () => {
    const messy = resolveExerciseVocabulary([
      "dumbbells",
      "dumbbells",
      "",
      null as unknown as string,
      undefined as unknown as string,
    ]);
    expect(messy.exercises.length).toBe(resolveExerciseVocabulary(["dumbbells"]).exercises.length);
    expect(messy.ignoredEquipment).toEqual([]);
  });

  it("every known wizard value is either mapped or explicitly reported as ignored", () => {
    // Guards the table against drifting out of sync with the wizard: a value
    // that maps to nothing must show up in ignoredEquipment, never vanish.
    const floor = resolveExerciseVocabulary([]).exercises.length;
    for (const value of KNOWN_EQUIPMENT_VALUES) {
      // `bodyweight` is the one legitimate no-op: it maps to the floor, which
      // is always available anyway. It is neither a grant nor an omission.
      if (value === "bodyweight") continue;
      const { exercises, ignoredEquipment } = resolveExerciseVocabulary([value]);
      const grantsSomething = exercises.length > floor;
      const reportedIgnored = ignoredEquipment.includes(value);
      expect(grantsSomething || reportedIgnored, `${value} silently grants nothing`).toBe(true);
    }
  });

  it("a full gym selection is a superset of a bodyweight-only one", () => {
    const bodyweightOnly = resolveExerciseVocabulary([]).exercises.length;
    const fullGym = resolveExerciseVocabulary([
      "barbell",
      "dumbbells",
      "cable_machine",
      "smith_machine",
      "leg_press",
      "bench",
      "pull_up_bar",
      "kettlebell",
      "resistance_bands",
    ]).exercises.length;
    expect(fullGym).toBeGreaterThan(bodyweightOnly);
  });
});
