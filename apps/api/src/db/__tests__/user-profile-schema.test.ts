import { describe, it, expect } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";
// RED: these imports will fail until userProfiles and its enums are added to schema.ts
import {
  userProfiles,
  goalEnum,
  experienceLevelEnum,
} from "../schema.js";

describe("user_profiles schema shape", () => {
  it("defines a userProfiles table", () => {
    expect(isTable(userProfiles)).toBe(true);
  });

  it("userProfiles table has a userId uuid column", () => {
    const cols = getTableColumns(userProfiles);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("userProfiles.userId references users.id", () => {
    const cols = getTableColumns(userProfiles);
    expect(cols.userId).toBeDefined();
  });

  it("userProfiles table has a name text column", () => {
    const cols = getTableColumns(userProfiles);
    expect(cols.name).toBeDefined();
    expect(cols.name.columnType).toBe("PgText");
  });

  it("userProfiles table has a goal goalEnum column", () => {
    const cols = getTableColumns(userProfiles);
    expect(cols.goal).toBeDefined();
    expect(cols.goal.columnType).toBe("PgEnumColumn");
  });

  it("userProfiles table has an experienceLevel experienceLevelEnum column", () => {
    const cols = getTableColumns(userProfiles);
    expect(cols.experienceLevel).toBeDefined();
    expect(cols.experienceLevel.columnType).toBe("PgEnumColumn");
  });

  it("userProfiles table has createdAt and updatedAt timestamps", () => {
    const cols = getTableColumns(userProfiles);
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });
});

describe("user profile enums", () => {
  it("goalEnum exposes the four goal values", () => {
    expect(goalEnum.enumValues).toEqual(
      expect.arrayContaining([
        "strength",
        "hypertrophy",
        "fat_loss",
        "general_fitness",
      ])
    );
  });

  it("experienceLevelEnum exposes the three experience values", () => {
    expect(experienceLevelEnum.enumValues).toEqual(
      expect.arrayContaining(["beginner", "intermediate", "advanced"])
    );
  });
});