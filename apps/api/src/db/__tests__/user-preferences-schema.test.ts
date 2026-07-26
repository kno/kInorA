import { describe, it, expect } from "vitest";
import { isTable } from "drizzle-orm/table";
import { getTableColumns } from "drizzle-orm/utils";
// RED: these imports will fail until userPreferences is added to schema.ts
import { userPreferences } from "../schema.js";

describe("user_preferences schema shape", () => {
  it("defines a userPreferences table", () => {
    expect(isTable(userPreferences)).toBe(true);
  });

  it("userPreferences table has a userId uuid column", () => {
    const cols = getTableColumns(userPreferences);
    expect(cols.userId).toBeDefined();
    expect(cols.userId.columnType).toBe("PgUUID");
  });

  it("userPreferences table has a defaultLocation text column", () => {
    const cols = getTableColumns(userPreferences);
    expect(cols.defaultLocation).toBeDefined();
    expect(cols.defaultLocation.columnType).toBe("PgText");
  });

  it("userPreferences table has a defaultDuration integer column", () => {
    const cols = getTableColumns(userPreferences);
    expect(cols.defaultDuration).toBeDefined();
    expect(cols.defaultDuration.columnType).toBe("PgInteger");
  });

  it("userPreferences table has a defaultEquipment column", () => {
    // Default to jsonb-backed text array per spec ("text array or jsonb").
    const cols = getTableColumns(userPreferences);
    expect(cols.defaultEquipment).toBeDefined();
  });

  it("userPreferences table has createdAt and updatedAt timestamps", () => {
    const cols = getTableColumns(userPreferences);
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  // A3 (13-v1.1-interactive-voice-chat): additive nullable TTS opt-out column.
  it("userPreferences table has a nullable ttsEnabled boolean column", () => {
    const cols = getTableColumns(userPreferences);
    expect(cols.ttsEnabled).toBeDefined();
    expect(cols.ttsEnabled.columnType).toBe("PgBoolean");
    // Nullable, no default — NULL = enabled (opt-out default ON).
    expect(cols.ttsEnabled.notNull).toBe(false);
    expect(cols.ttsEnabled.hasDefault).toBe(false);
  });
});