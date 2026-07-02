import type { PlanGoal, TrainingLocation } from "@kinora/contracts";

/**
 * Static option catalogues for the create-plan wizard steps.
 *
 * Kept framework-free so step components and tests share one source of truth.
 * Equipment is keyed by training location because the selected location
 * constrains which equipment options are offered (spec requirement).
 *
 * i18n (issue #67): user-facing labels/descriptions/alt-text are carried as
 * stable catalog KEY references (`*Key`) plus an English fallback (`*Fallback`).
 * Step components resolve them with `t(key, fallback)` so nothing breaks if a
 * key is missing. The `value` strings are persisted into PlanSpec and MUST NOT
 * change.
 */

export interface GoalOption {
  value: PlanGoal;
  labelKey: string;
  labelFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
}

export const GOAL_OPTIONS: readonly GoalOption[] = [
  {
    value: "strength",
    labelKey: "wizard_goal_strength_label",
    labelFallback: "Strength",
    descriptionKey: "wizard_goal_strength_desc",
    descriptionFallback: "Build raw, maximal power",
  },
  {
    value: "hypertrophy",
    labelKey: "wizard_goal_hypertrophy_label",
    labelFallback: "Hypertrophy",
    descriptionKey: "wizard_goal_hypertrophy_desc",
    descriptionFallback: "Grow muscle size",
  },
  {
    value: "fat_loss",
    labelKey: "wizard_goal_fat_loss_label",
    labelFallback: "Fat loss",
    descriptionKey: "wizard_goal_fat_loss_desc",
    descriptionFallback: "Progressive calorie deficit",
  },
  {
    value: "general_fitness",
    labelKey: "wizard_goal_general_fitness_label",
    labelFallback: "General fitness",
    descriptionKey: "wizard_goal_general_fitness_desc",
    descriptionFallback: "Stay healthy and active",
  },
];

export interface LocationOption {
  value: TrainingLocation;
  labelKey: string;
  labelFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
}

export const LOCATION_OPTIONS: readonly LocationOption[] = [
  {
    value: "home",
    labelKey: "wizard_location_home_label",
    labelFallback: "Home",
    descriptionKey: "wizard_location_home_desc",
    descriptionFallback: "Train in your own space",
  },
  {
    value: "gym",
    labelKey: "wizard_location_gym_label",
    labelFallback: "Gym",
    descriptionKey: "wizard_location_gym_desc",
    descriptionFallback: "Full equipment access",
  },
  {
    value: "outdoor",
    labelKey: "wizard_location_outdoor_label",
    labelFallback: "Outdoor",
    descriptionKey: "wizard_location_outdoor_desc",
    descriptionFallback: "Parks, trails, open air",
  },
];

export const FREQUENCY_OPTIONS: readonly number[] = [2, 3, 4, 5, 6];

export const DURATION_OPTIONS: readonly number[] = [15, 30, 45, 60, 90];

export interface EquipmentOption {
  value: string;
  labelKey: string;
  labelFallback: string;
}

/** Equipment catalogue, scoped by training location. */
export const EQUIPMENT_BY_LOCATION: Record<TrainingLocation, EquipmentOption[]> = {
  home: [
    {
      value: "dumbbells",
      labelKey: "wizard_equipment_dumbbells_label",
      labelFallback: "Dumbbells",
    },
    {
      value: "resistance_bands",
      labelKey: "wizard_equipment_resistance_bands_label",
      labelFallback: "Resistance bands",
    },
    {
      value: "pull_up_bar",
      labelKey: "wizard_equipment_pull_up_bar_label",
      labelFallback: "Pull-up bar",
    },
    {
      value: "kettlebell",
      labelKey: "wizard_equipment_kettlebell_label",
      labelFallback: "Kettlebell",
    },
    {
      value: "bench",
      labelKey: "wizard_equipment_bench_label",
      labelFallback: "Bench",
    },
  ],
  gym: [
    {
      value: "barbell",
      labelKey: "wizard_equipment_barbell_label",
      labelFallback: "Barbell",
    },
    {
      value: "dumbbells",
      labelKey: "wizard_equipment_dumbbells_label",
      labelFallback: "Dumbbells",
    },
    {
      value: "cable_machine",
      labelKey: "wizard_equipment_cable_machine_label",
      labelFallback: "Cable machine",
    },
    {
      value: "smith_machine",
      labelKey: "wizard_equipment_smith_machine_label",
      labelFallback: "Smith machine",
    },
    {
      value: "leg_press",
      labelKey: "wizard_equipment_leg_press_label",
      labelFallback: "Leg press",
    },
    {
      value: "bench",
      labelKey: "wizard_equipment_bench_label",
      labelFallback: "Bench",
    },
  ],
  outdoor: [
    {
      value: "resistance_bands",
      labelKey: "wizard_equipment_resistance_bands_label",
      labelFallback: "Resistance bands",
    },
    {
      value: "pull_up_bar",
      labelKey: "wizard_equipment_pull_up_bar_label",
      labelFallback: "Pull-up bar",
    },
    {
      value: "bodyweight",
      labelKey: "wizard_equipment_bodyweight_label",
      labelFallback: "Bodyweight only",
    },
    {
      value: "suspension_trainer",
      labelKey: "wizard_equipment_suspension_trainer_label",
      labelFallback: "Suspension trainer",
    },
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
  /** i18n catalog key for the alt-text. */
  altKey: string;
  /** English alt-text fallback used when the key is missing. */
  altFallback: string;
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
    altKey: "wizard_equipment_dumbbells_alt",
    altFallback: "A pair of adjustable dumbbells",
  },
  barbell: {
    src: "/equipment/equip-barras.webp",
    altKey: "wizard_equipment_barbell_alt",
    altFallback: "An Olympic barbell loaded with plates",
  },
  resistance_bands: {
    src: "/equipment/equip-bandas.webp",
    altKey: "wizard_equipment_resistance_bands_alt",
    altFallback: "A set of elastic resistance bands",
  },
  bodyweight: {
    src: "/equipment/equip-peso-corporal.webp",
    altKey: "wizard_equipment_bodyweight_alt",
    altFallback: "An athlete doing a one-arm push-up",
  },
  cable_machine: {
    src: "/equipment/equip-maquinas.webp",
    altKey: "wizard_equipment_cable_machine_alt",
    altFallback: "A cable pulley station in a gym",
  },
  pull_up_bar: {
    src: "/equipment/equip-dominadas.webp",
    altKey: "wizard_equipment_pull_up_bar_alt",
    altFallback: "Doorway pull-up bar",
  },
  kettlebell: {
    src: "/equipment/equip-kettlebell.webp",
    altKey: "wizard_equipment_kettlebell_alt",
    altFallback: "Kettlebell",
  },
  bench: {
    src: "/equipment/equip-banco.webp",
    altKey: "wizard_equipment_bench_alt",
    altFallback: "Adjustable weight bench",
  },
  leg_press: {
    src: "/equipment/equip-prensa.webp",
    altKey: "wizard_equipment_leg_press_alt",
    altFallback: "Leg press machine",
  },
  suspension_trainer: {
    src: "/equipment/equip-trx.webp",
    altKey: "wizard_equipment_suspension_trainer_alt",
    altFallback: "Suspension trainer straps",
  },
  // smith_machine has NO photo: design verified none of the source images
  // depicts a Smith machine (equip-maquinas is a cable machine, used above).
  // It falls back to the dumbbell icon.
};

export function equipmentPhotoForValue(value: string): EquipmentPhoto | undefined {
  return EQUIPMENT_PHOTO_BY_VALUE[value];
}
