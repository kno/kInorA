import { describe, it, expect, expectTypeOf } from "vitest";
import type { UserPreferences } from "../index.js";

/**
 * `UserPreferences.ttsEnabled` (13-v1.1-interactive-voice-chat, A3) is an
 * ADDITIVE, backward-compatible field. This package exports TypeScript-only
 * contracts, so the boundary is verified with Vitest type assertions rather
 * than a runtime coverage report (see vitest.config.ts).
 */
describe("UserPreferences.ttsEnabled (additive, backward-compatible)", () => {
  it("still validates when ttsEnabled is omitted (backward-compatible)", () => {
    const legacy: UserPreferences = {
      userId: "u1",
      defaultLocation: null,
      defaultDuration: null,
      defaultEquipment: null,
    };
    expect(legacy.ttsEnabled).toBeUndefined();
  });

  it("accepts true, false, and null for ttsEnabled", () => {
    const enabled: UserPreferences = {
      userId: "u1",
      defaultLocation: null,
      defaultDuration: null,
      defaultEquipment: null,
      ttsEnabled: true,
    };
    const optedOut: UserPreferences = {
      userId: "u2",
      defaultLocation: null,
      defaultDuration: null,
      defaultEquipment: null,
      ttsEnabled: false,
    };
    const nulled: UserPreferences = {
      userId: "u3",
      defaultLocation: null,
      defaultDuration: null,
      defaultEquipment: null,
      ttsEnabled: null,
    };
    expect(enabled.ttsEnabled).toBe(true);
    expect(optedOut.ttsEnabled).toBe(false);
    expect(nulled.ttsEnabled).toBeNull();
  });

  it("types ttsEnabled as optional boolean | null", () => {
    expectTypeOf<UserPreferences["ttsEnabled"]>().toEqualTypeOf<boolean | null | undefined>();
  });
});
