import type { PlanGoal, TrainingLocation } from "@kinora/contracts";

/**
 * Static option catalogues for the create-plan wizard steps.
 *
 * Kept framework-free so step components and tests share one source of truth.
 * Equipment is keyed by training location because the selected location
 * constrains which equipment options are offered (spec requirement).
 */

export interface GoalOption {
  value: PlanGoal;
  label: string;
  description: string;
}

export const GOAL_OPTIONS: readonly GoalOption[] = [
  { value: "strength", label: "Strength", description: "Build raw, maximal power" },
  { value: "hypertrophy", label: "Hypertrophy", description: "Grow muscle size" },
  { value: "fat_loss", label: "Fat loss", description: "Progressive calorie deficit" },
  {
    value: "general_fitness",
    label: "General fitness",
    description: "Stay healthy and active",
  },
];

export interface LocationOption {
  value: TrainingLocation;
  label: string;
  description: string;
}

export const LOCATION_OPTIONS: readonly LocationOption[] = [
  { value: "home", label: "Home", description: "Train in your own space" },
  { value: "gym", label: "Gym", description: "Full equipment access" },
  { value: "outdoor", label: "Outdoor", description: "Parks, trails, open air" },
];

export const FREQUENCY_OPTIONS: readonly number[] = [2, 3, 4, 5, 6];

export const DURATION_OPTIONS: readonly number[] = [15, 30, 45, 60, 90];

export interface EquipmentOption {
  value: string;
  label: string;
}

/** Equipment catalogue, scoped by training location. */
export const EQUIPMENT_BY_LOCATION: Record<TrainingLocation, EquipmentOption[]> = {
  home: [
    { value: "dumbbells", label: "Dumbbells" },
    { value: "resistance_bands", label: "Resistance bands" },
    { value: "pull_up_bar", label: "Pull-up bar" },
    { value: "kettlebell", label: "Kettlebell" },
    { value: "bench", label: "Bench" },
  ],
  gym: [
    { value: "barbell", label: "Barbell" },
    { value: "dumbbells", label: "Dumbbells" },
    { value: "cable_machine", label: "Cable machine" },
    { value: "smith_machine", label: "Smith machine" },
    { value: "leg_press", label: "Leg press" },
    { value: "bench", label: "Bench" },
  ],
  outdoor: [
    { value: "resistance_bands", label: "Resistance bands" },
    { value: "pull_up_bar", label: "Pull-up bar" },
    { value: "bodyweight", label: "Bodyweight only" },
    { value: "suspension_trainer", label: "Suspension trainer" },
  ],
};

export function equipmentForLocation(
  location: TrainingLocation | undefined,
): EquipmentOption[] {
  if (!location) return [];
  return EQUIPMENT_BY_LOCATION[location];
}
