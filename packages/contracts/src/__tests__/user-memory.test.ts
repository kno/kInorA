import { describe, it, expectTypeOf } from "vitest";
// RED: these imports reference types that do not exist in index.ts yet
import type {
  ExperienceLevel,
  SelfDescribedSex,
  UserProfile,
  UserPreferences,
  UpdateProfileRequest,
  UpdatePreferencesRequest,
  PlanGoal,
} from "../index";

describe("user profile + preferences contract types (10a/10b)", () => {
  it("ExperienceLevel is the three-value union", () => {
    expectTypeOf<ExperienceLevel>().toEqualTypeOf<
      "beginner" | "intermediate" | "advanced"
    >();
  });

  it("UserProfile carries userId/name/goal/experienceLevel/selfDescribedSex/heightCm", () => {
    expectTypeOf<UserProfile>().toEqualTypeOf<{
      userId: string;
      name: string;
      goal: PlanGoal | null;
      experienceLevel: ExperienceLevel | null;
      selfDescribedSex: SelfDescribedSex | null;
      heightCm: number | null;
    }>();
  });

  it("UserPreferences carries userId/defaultLocation/defaultDuration/defaultEquipment + optional ttsEnabled", () => {
    expectTypeOf<UserPreferences>().toEqualTypeOf<{
      userId: string;
      defaultLocation: string | null;
      defaultDuration: number | null;
      defaultEquipment: string[] | null;
      ttsEnabled?: boolean | null;
    }>();
  });

  it("UpdateProfileRequest requires name, goal and experienceLevel optional", () => {
    expectTypeOf<UpdateProfileRequest>().toEqualTypeOf<{
      name: string;
      goal?: PlanGoal;
      experienceLevel?: ExperienceLevel;
    }>();
  });

  it("UpdatePreferencesRequest has three optional fields", () => {
    expectTypeOf<UpdatePreferencesRequest>().toEqualTypeOf<{
      defaultLocation?: string;
      defaultDuration?: number;
      defaultEquipment?: string[];
    }>();
  });

  it("UpdatePreferencesRequest allows omitting every field (partial)", () => {
    // An empty object MUST be assignable to UpdatePreferencesRequest
    // (every field is optional), proving it is a true partial update body.
    expectTypeOf<{}>().toMatchTypeOf<UpdatePreferencesRequest>();
  });
});