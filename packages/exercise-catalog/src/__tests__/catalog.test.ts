import { describe, expect, it } from "vitest";

import {
  BODY_PARTS,
  getExerciseById,
  listExercises,
  tallyExerciseFacets,
  type ExerciseCatalogRecord,
} from "../index.js";

/** Total number of records shipped in the generated catalog. */
const CATALOG_SIZE = 1324;

function allRecords(): ExerciseCatalogRecord[] {
  return listExercises().items;
}

describe("catalog integrity", () => {
  it("exposes every shipped record with no filters", () => {
    const { items, total } = listExercises();
    expect(total).toBe(CATALOG_SIZE);
    expect(items).toHaveLength(CATALOG_SIZE);
  });

  it("defaults to no filters when called with no argument", () => {
    expect(listExercises().total).toBe(listExercises({}).total);
  });

  it("has unique ids", () => {
    const ids = new Set(allRecords().map((record) => record.id));
    expect(ids.size).toBe(CATALOG_SIZE);
  });

  it("keeps every record on the BodyPart union", () => {
    const known = new Set<string>(BODY_PARTS);
    const unknown = allRecords().filter((record) => !known.has(record.bodyPart));
    expect(unknown).toEqual([]);
  });

  it("serves every thumbnail from the app's own /exercises/images path", () => {
    const bad = allRecords().filter(
      (record) => !/^\/exercises\/images\/[^/]+\.jpg$/.test(record.imagePath),
    );
    expect(bad).toEqual([]);
  });

  it("serves every animation from jsDelivr pinned to an immutable commit SHA", () => {
    // A branch ref (`@main`) would let an upstream force-push silently change or
    // 404 every animation in production, so the pin MUST be a 40-hex SHA.
    const pinned =
      /^https:\/\/cdn\.jsdelivr\.net\/gh\/hasaneyldrm\/exercises-dataset@[0-9a-f]{40}\/videos\/[^/]+\.gif$/;
    const bad = allRecords().filter((record) => !pinned.test(record.gifPath));
    expect(bad).toEqual([]);
  });

  it("pins every animation to the SAME commit", () => {
    const shas = new Set(
      allRecords().map((record) => /@([0-9a-f]{40})\//.exec(record.gifPath)?.[1]),
    );
    expect(shas.size).toBe(1);
    expect(shas.has(undefined)).toBe(false);
  });

  it("derives the gif filename from the same media id as the thumbnail", () => {
    const mismatched = allRecords().filter((record) => {
      const image = record.imagePath.replace(/^.*\//, "").replace(/\.jpg$/, "");
      const gif = record.gifPath.replace(/^.*\//, "").replace(/\.gif$/, "");
      return image !== gif;
    });
    expect(mismatched).toEqual([]);
  });

  it("preserves the Gym visual media attribution on every record", () => {
    const missing = allRecords().filter(
      (record) => !record.attribution.includes("gymvisual.com"),
    );
    expect(missing).toEqual([]);
  });

  it("ships non-empty EN and ES instruction steps for every record", () => {
    const broken = allRecords().filter(
      (record) =>
        record.instructionSteps.en.length === 0 ||
        record.instructionSteps.es.length === 0,
    );
    expect(broken).toEqual([]);
  });
});

describe("listExercises — multi-value filtering (additive facets)", () => {
  it("treats an empty bodyPart list the same as an absent one", () => {
    expect(listExercises({ bodyPart: [] }).total).toBe(listExercises({}).total);
  });

  it("matches ANY listed value within a group (OR within group)", () => {
    expect(listExercises({ bodyPart: ["cardio", "chest"] }).total).toBe(192);
  });

  it("ANDs a second group on top of a widened first group", () => {
    expect(
      listExercises({ bodyPart: ["cardio", "chest"], equipment: ["body weight"] }).total,
    ).toBe(57);
  });

  it("a single-element list reduces to the old exact-match behaviour", () => {
    expect(listExercises({ bodyPart: ["neck"] }).total).toBe(
      listExercises({ bodyPart: ["neck"] }).items.length,
    );
    expect(listExercises({ bodyPart: ["neck"] }).total).toBeGreaterThan(0);
  });
});

describe("listExercises — bodyPart filter", () => {
  it("returns only matching records", () => {
    const { items, total } = listExercises({ bodyPart: ["neck"] });
    expect(total).toBe(items.length);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((record) => record.bodyPart === "neck")).toBe(true);
  });

  it("partitions the catalog across every body part", () => {
    const sum = BODY_PARTS.reduce(
      (acc, bodyPart) => acc + listExercises({ bodyPart: [bodyPart] }).total,
      0,
    );
    expect(sum).toBe(CATALOG_SIZE);
  });
});

describe("listExercises — equipment filter", () => {
  it("matches exactly", () => {
    const { items, total } = listExercises({ equipment: ["body weight"] });
    expect(items.every((record) => record.equipment === "body weight")).toBe(true);
    expect(total).toBeGreaterThan(0);
  });

  it("returns an empty page for an unknown equipment label", () => {
    expect(listExercises({ equipment: ["jetpack"] })).toEqual({ items: [], total: 0 });
  });
});

describe("listExercises — target filter", () => {
  it("matches exactly", () => {
    const { items, total } = listExercises({ target: ["abs"] });
    expect(items.every((record) => record.target === "abs")).toBe(true);
    expect(total).toBeGreaterThan(0);
  });

  it("returns an empty page for an unknown target", () => {
    expect(listExercises({ target: ["gills"] }).total).toBe(0);
  });
});

describe("listExercises — search", () => {
  it("matches a name substring", () => {
    const { items, total } = listExercises({ search: "sit-up" });
    expect(total).toBeGreaterThan(0);
    expect(items.every((record) => record.name.includes("sit-up"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(listExercises({ search: "SIT-UP" }).total).toBe(
      listExercises({ search: "sit-up" }).total,
    );
  });

  it("is accent-insensitive", () => {
    expect(listExercises({ search: "sít-úp" }).total).toBe(
      listExercises({ search: "sit-up" }).total,
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(listExercises({ search: "  squat  " }).total).toBe(
      listExercises({ search: "squat" }).total,
    );
  });

  it("treats a blank search as absent", () => {
    expect(listExercises({ search: "   " }).total).toBe(CATALOG_SIZE);
    expect(listExercises({ search: "" }).total).toBe(CATALOG_SIZE);
  });

  it("returns an empty page when nothing matches", () => {
    expect(listExercises({ search: "zzzz-no-such-exercise" })).toEqual({
      items: [],
      total: 0,
    });
  });
});

describe("listExercises — combined filters", () => {
  it("ANDs every supplied filter", () => {
    const filters = {
      bodyPart: ["waist"],
      equipment: ["body weight"],
      target: ["abs"],
      search: "sit-up",
    } as const;
    const { items, total } = listExercises(filters);
    expect(total).toBeGreaterThan(0);
    expect(
      items.every(
        (record) =>
          record.bodyPart === "waist" &&
          record.equipment === "body weight" &&
          record.target === "abs" &&
          record.name.includes("sit-up"),
      ),
    ).toBe(true);
  });

  it("returns nothing for a contradictory combination", () => {
    expect(listExercises({ bodyPart: ["neck"], target: ["abs"] }).total).toBe(0);
  });
});

describe("listExercises — pagination", () => {
  it("applies limit while reporting the full match count", () => {
    const { items, total } = listExercises({ limit: 10 });
    expect(items).toHaveLength(10);
    expect(total).toBe(CATALOG_SIZE);
  });

  it("applies offset", () => {
    const all = listExercises({ limit: 5 }).items;
    const offset = listExercises({ limit: 4, offset: 1 }).items;
    expect(offset.map((record) => record.id)).toEqual(
      all.slice(1).map((record) => record.id),
    );
  });

  it("does not paginate when limit and offset are omitted", () => {
    expect(listExercises({ bodyPart: ["cardio"] }).items.length).toBe(
      listExercises({ bodyPart: ["cardio"] }).total,
    );
  });

  it("clamps a negative offset to the start", () => {
    expect(listExercises({ limit: 3, offset: -50 }).items.map((r) => r.id)).toEqual(
      listExercises({ limit: 3, offset: 0 }).items.map((r) => r.id),
    );
  });

  it("clamps an offset past the end to an empty page", () => {
    const { items, total } = listExercises({ offset: CATALOG_SIZE + 500 });
    expect(items).toEqual([]);
    expect(total).toBe(CATALOG_SIZE);
  });

  it("truncates fractional offsets and limits", () => {
    expect(listExercises({ limit: 2.9, offset: 1.9 }).items.map((r) => r.id)).toEqual(
      listExercises({ limit: 2, offset: 1 }).items.map((r) => r.id),
    );
  });

  it("returns an empty page for a zero or negative limit", () => {
    expect(listExercises({ limit: 0 }).items).toEqual([]);
    expect(listExercises({ limit: -5 }).items).toEqual([]);
    expect(listExercises({ limit: -5 }).total).toBe(CATALOG_SIZE);
  });

  it("clamps a limit larger than the remaining matches", () => {
    const { items } = listExercises({ limit: 10_000, offset: CATALOG_SIZE - 3 });
    expect(items).toHaveLength(3);
  });

  it("paginates a filtered result set", () => {
    const filtered = listExercises({ bodyPart: ["neck"] });
    const page = listExercises({ bodyPart: ["neck"], limit: 1, offset: 1 });
    expect(page.total).toBe(filtered.total);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(filtered.items[1]?.id);
  });
});

describe("tallyExerciseFacets", () => {
  it("tallies every group over the whole catalog with no filters", () => {
    const tally = tallyExerciseFacets();
    for (const key of ["bodyPart", "equipment", "target"] as const) {
      const sum = tally[key].reduce((acc, facet) => acc + facet.count, 0);
      expect(sum).toBe(CATALOG_SIZE);
    }
  });

  it("computes equipment(20)/target(3) under a two-value bodyPart filter, self-excluding bodyPart", () => {
    const tally = tallyExerciseFacets({ bodyPart: ["cardio", "chest"] });

    expect(tally.equipment).toHaveLength(20);
    expect(tally.target).toHaveLength(3);
    expect(tally.target).toEqual(
      expect.arrayContaining([
        { value: "cardiovascular system", count: 29 },
        { value: "pectorals", count: 158 },
        { value: "serratus anterior", count: 5 },
      ]),
    );
    // Self-exclusion: bodyPart's own tally ignores its own selection and still
    // lists all 10 body parts, not just cardio/chest.
    expect(tally.bodyPart).toHaveLength(10);
  });

  it("re-tallies target when a second group narrows the same selection", () => {
    // The spec's combined-filter scenario. Adding equipment on top of the two
    // body parts must shift the target counts (29/158/5 -> 21/34/2), not just
    // the result total — this is the assertion that would catch a tally
    // computed against the wrong filter set while every other number still
    // looked right.
    const tally = tallyExerciseFacets({
      bodyPart: ["cardio", "chest"],
      equipment: ["body weight"],
    });

    expect(tally.target).toEqual(
      expect.arrayContaining([
        { value: "cardiovascular system", count: 21 },
        { value: "pectorals", count: 34 },
        { value: "serratus anterior", count: 2 },
      ]),
    );
  });

  it("computes equipment(7)/target(1) under a single-value bodyPart filter", () => {
    const tally = tallyExerciseFacets({ bodyPart: ["cardio"] });

    expect(tally.equipment).toHaveLength(7);
    expect(tally.target).toHaveLength(1);
  });

  it("orders each group by count descending, then value ascending", () => {
    const tally = tallyExerciseFacets({ bodyPart: ["cardio", "chest"] });

    for (const key of ["bodyPart", "equipment", "target"] as const) {
      const group = tally[key];
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1]!;
        const curr = group[i]!;
        const orderedByCount = prev.count > curr.count;
        const tiedThenByValue =
          prev.count === curr.count && prev.value.localeCompare(curr.value) <= 0;
        expect(orderedByCount || tiedThenByValue).toBe(true);
      }
    }
  });

  it("applies search as an AND dimension across every group's tally", () => {
    const unfiltered = tallyExerciseFacets();
    const searched = tallyExerciseFacets({ search: "press" });

    const unfilteredTotal = unfiltered.bodyPart.reduce((acc, f) => acc + f.count, 0);
    const searchedTotal = searched.bodyPart.reduce((acc, f) => acc + f.count, 0);
    expect(searchedTotal).toBeLessThan(unfilteredTotal);
    expect(searchedTotal).toBe(listExercises({ search: "press" }).total);
  });
});

describe("getExerciseById", () => {
  it("returns the record for a known id", () => {
    const record = getExerciseById("0001");
    expect(record?.id).toBe("0001");
    expect(record?.name).toBe("3/4 sit-up");
    expect(record?.bodyPart).toBe("waist");
  });

  it("returns undefined for an unknown id", () => {
    expect(getExerciseById("does-not-exist")).toBeUndefined();
  });

  it("resolves every record listed by listExercises", () => {
    const unresolved = allRecords().filter(
      (record) => getExerciseById(record.id) === undefined,
    );
    expect(unresolved).toEqual([]);
  });
});
