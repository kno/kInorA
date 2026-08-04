import { describe, expect, it } from "vitest";

import {
  EXERCISE_BODY_PARTS,
  ExerciseCatalogDetailSchema,
  ExerciseCatalogItemSchema,
  ExerciseCatalogListResponseSchema,
} from "../index";

const validItem = {
  id: "0001",
  name: "3/4 sit-up",
  bodyPart: "waist",
  equipment: "body weight",
  target: "abs",
  muscleGroup: "hip flexors",
  imagePath: "/exercises/images/0001-2gPfomN.jpg",
  // CDN-served, SHA-pinned absolute URL — see ExerciseCatalogItemSchema.gifPath.
  gifPath:
    "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/0001-2gPfomN.gif",
  attribution: "© Gym visual — https://gymvisual.com/",
};

const validDetail = {
  ...validItem,
  secondaryMuscles: ["hip flexors", "lower back"],
  instructionSteps: {
    en: ["Lie flat on your back.", "Curl forward."],
    es: ["Túmbate sobre tu espalda.", "Cúrvate hacia adelante."],
  },
};

describe("EXERCISE_BODY_PARTS", () => {
  it("is the settled ten-value taxonomy", () => {
    expect(EXERCISE_BODY_PARTS).toEqual([
      "back",
      "cardio",
      "chest",
      "lower arms",
      "lower legs",
      "neck",
      "shoulders",
      "upper arms",
      "upper legs",
      "waist",
    ]);
  });
});

describe("ExerciseCatalogItemSchema", () => {
  it("accepts a well-formed list item", () => {
    expect(ExerciseCatalogItemSchema.parse(validItem)).toEqual(validItem);
  });

  it("accepts every body part", () => {
    for (const bodyPart of EXERCISE_BODY_PARTS) {
      expect(
        ExerciseCatalogItemSchema.safeParse({ ...validItem, bodyPart }).success,
      ).toBe(true);
    }
  });

  it("rejects an unknown body part", () => {
    expect(
      ExerciseCatalogItemSchema.safeParse({ ...validItem, bodyPart: "gills" }).success,
    ).toBe(false);
  });

  it("requires the media attribution", () => {
    const { attribution: _dropped, ...withoutAttribution } = validItem;
    expect(ExerciseCatalogItemSchema.safeParse(withoutAttribution).success).toBe(false);
    expect(
      ExerciseCatalogItemSchema.safeParse({ ...validItem, attribution: "" }).success,
    ).toBe(false);
  });

  it("rejects blank identity fields", () => {
    expect(ExerciseCatalogItemSchema.safeParse({ ...validItem, id: "" }).success).toBe(
      false,
    );
    expect(ExerciseCatalogItemSchema.safeParse({ ...validItem, name: "" }).success).toBe(
      false,
    );
  });

  it("stays agnostic about where the media is hosted", () => {
    // gifPath is a plain non-empty string on purpose: the wire contract must not
    // break if the animations move back from the CDN to self-hosting.
    expect(
      ExerciseCatalogItemSchema.safeParse({
        ...validItem,
        gifPath: "/exercises/videos/0001-2gPfomN.gif",
      }).success,
    ).toBe(true);
    expect(
      ExerciseCatalogItemSchema.safeParse({ ...validItem, gifPath: "" }).success,
    ).toBe(false);
  });

  it("does NOT carry the heavy detail payload", () => {
    const parsed = ExerciseCatalogItemSchema.parse(validDetail);
    expect(parsed).not.toHaveProperty("instructionSteps");
    expect(parsed).not.toHaveProperty("secondaryMuscles");
  });
});

describe("ExerciseCatalogDetailSchema", () => {
  it("accepts a well-formed detail record", () => {
    expect(ExerciseCatalogDetailSchema.parse(validDetail)).toEqual(validDetail);
  });

  it("extends the list item shape", () => {
    const parsed = ExerciseCatalogDetailSchema.parse(validDetail);
    expect(parsed.id).toBe(validItem.id);
    expect(parsed.attribution).toBe(validItem.attribution);
  });

  it("accepts an empty secondaryMuscles list", () => {
    expect(
      ExerciseCatalogDetailSchema.safeParse({ ...validDetail, secondaryMuscles: [] })
        .success,
    ).toBe(true);
  });

  it("requires both shipped locales to be non-empty", () => {
    expect(
      ExerciseCatalogDetailSchema.safeParse({
        ...validDetail,
        instructionSteps: { en: [], es: ["paso"] },
      }).success,
    ).toBe(false);
    expect(
      ExerciseCatalogDetailSchema.safeParse({
        ...validDetail,
        instructionSteps: { en: ["step"] },
      }).success,
    ).toBe(false);
  });
});

describe("ExerciseCatalogListResponseSchema", () => {
  it("accepts a well-formed page", () => {
    const page = { items: [validItem], total: 1324, limit: 24, offset: 0 };
    expect(ExerciseCatalogListResponseSchema.parse(page)).toEqual(page);
  });

  it("accepts an empty page", () => {
    expect(
      ExerciseCatalogListResponseSchema.safeParse({
        items: [],
        total: 0,
        limit: 24,
        offset: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects negative or fractional pagination values", () => {
    const base = { items: [], total: 0, limit: 24, offset: 0 };
    expect(ExerciseCatalogListResponseSchema.safeParse({ ...base, offset: -1 }).success).toBe(
      false,
    );
    expect(ExerciseCatalogListResponseSchema.safeParse({ ...base, limit: 1.5 }).success).toBe(
      false,
    );
    expect(ExerciseCatalogListResponseSchema.safeParse({ ...base, total: -3 }).success).toBe(
      false,
    );
  });

  it("rejects a malformed item inside the page", () => {
    expect(
      ExerciseCatalogListResponseSchema.safeParse({
        items: [{ ...validItem, bodyPart: "tail" }],
        total: 1,
        limit: 24,
        offset: 0,
      }).success,
    ).toBe(false);
  });
});
