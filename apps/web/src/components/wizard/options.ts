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

export interface EquipmentPhoto {
  /** Public path under apps/web/public — served as a plain lazy <img>. */
  src: string;
  /** English alt-text literal (Option A — no i18n catalog keys). */
  alt: string;
}

/**
 * Optional, purely-presentational photos for the static equipment options
 * (OpenDesign assets under `public/equipment/`). Keyed by the real
 * {@link EQUIPMENT_BY_LOCATION} value, and only where an app value clearly
 * corresponds to one of the six available assets. Values without an entry
 * render with no photo (the equipment data model is unchanged).
 */
export const EQUIPMENT_PHOTO_BY_VALUE: Readonly<Record<string, EquipmentPhoto>> = {
  dumbbells: {
    src: "/equipment/equip-mancuernas.webp",
    alt: "A pair of adjustable dumbbells",
  },
  barbell: {
    src: "/equipment/equip-barras.webp",
    alt: "An Olympic barbell loaded with plates",
  },
  resistance_bands: {
    src: "/equipment/equip-bandas.webp",
    alt: "A set of elastic resistance bands",
  },
  bodyweight: {
    src: "/equipment/equip-peso-corporal.webp",
    alt: "An athlete doing a one-arm push-up",
  },
  cable_machine: {
    src: "/equipment/equip-maquinas.webp",
    alt: "A cable pulley station in a gym",
  },
  pull_up_bar: {
    src: "/equipment/equip-dominadas.webp",
    alt: "Doorway pull-up bar",
  },
  kettlebell: {
    src: "/equipment/equip-kettlebell.webp",
    alt: "Kettlebell",
  },
  bench: {
    src: "/equipment/equip-banco.webp",
    alt: "Adjustable weight bench",
  },
  leg_press: {
    src: "/equipment/equip-prensa.webp",
    alt: "Leg press machine",
  },
  suspension_trainer: {
    src: "/equipment/equip-trx.webp",
    alt: "Suspension trainer straps",
  },
  // smith_machine has NO photo: design verified none of the source images
  // depicts a Smith machine (equip-maquinas is a cable machine, used above).
  // It falls back to the dumbbell icon.
};

export function equipmentPhotoForValue(value: string): EquipmentPhoto | undefined {
  return EQUIPMENT_PHOTO_BY_VALUE[value];
}
