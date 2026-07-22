import type { PlanGoal, ExperienceLevel } from "@kinora/contracts";

/**
 * Static option catalogues for the profile form selects (Slice 4 of
 * 10a-user-memory-structured).
 *
 * Framework-free so the form component and tests share one source of truth —
 * mirrors `components/wizard/options.ts`. The `value` strings are the
 * persisted enum values and MUST mirror the `goalEnum`/`experienceLevelEnum`
 * pgEnums; the `labelKey` strings are stable catalog keys resolved with
 * `useTranslations()`.
 *
 * The goal labels REUSE the existing `wizard.goal.*.label` keys (single source
 * of truth — the profile goal IS the wizard goal). Experience-level labels are
 * new under `profile.experience.*`.
 */

export interface ProfileSelectOption<T extends string> {
  value: T;
  labelKey: string;
}

export const GOAL_SELECT_OPTIONS: readonly ProfileSelectOption<PlanGoal>[] = [
  { value: "strength", labelKey: "wizard.goal.strength.label" },
  { value: "hypertrophy", labelKey: "wizard.goal.hypertrophy.label" },
  { value: "fat_loss", labelKey: "wizard.goal.fatLoss.label" },
  { value: "general_fitness", labelKey: "wizard.goal.generalFitness.label" },
];

export const EXPERIENCE_SELECT_OPTIONS: readonly ProfileSelectOption<ExperienceLevel>[] = [
  { value: "beginner", labelKey: "profile.experience.beginner" },
  { value: "intermediate", labelKey: "profile.experience.intermediate" },
  { value: "advanced", labelKey: "profile.experience.advanced" },
];