import { describe, expect, it } from "vitest";
import { equipmentForLocation, EQUIPMENT_BY_LOCATION } from "../options";

describe("equipmentForLocation", () => {
  it("returns the gym catalogue for the gym location", () => {
    expect(equipmentForLocation("gym")).toBe(EQUIPMENT_BY_LOCATION.gym);
    expect(equipmentForLocation("gym").some((o) => o.value === "barbell")).toBe(true);
  });

  it("returns the home catalogue for the home location", () => {
    expect(equipmentForLocation("home")).toBe(EQUIPMENT_BY_LOCATION.home);
  });

  it("returns an empty list when location is undefined", () => {
    expect(equipmentForLocation(undefined)).toEqual([]);
  });
});
