import type { PlanGoal, TrainingLocation } from "@kinora/contracts";

/**
 * Static option catalogues for the create-plan wizard steps.
 *
 * Kept framework-free so step components and tests share one source of truth.
 * Equipment is keyed by training location because the selected location
 * constrains which equipment options are offered (spec requirement).
 *
 * i18n (issue #67, migrated to next-intl in #100 slice 6): user-facing
 * labels/descriptions/alt-text are carried as stable, nested catalog KEY
 * references (`*Key`) resolved with `useTranslations()` — no in-code English
 * fallback anymore; the catalog-parity guard (`@kinora/i18n`) is the single
 * source of truth for the copy. The `value` strings are persisted into
 * PlanSpec and MUST NOT change.
 */

export interface GoalOption {
  value: PlanGoal;
  labelKey: string;
  descriptionKey: string;
}

export const GOAL_OPTIONS: readonly GoalOption[] = [
  {
    value: "strength",
    labelKey: "wizard.goal.strength.label",
    descriptionKey: "wizard.goal.strength.desc",
  },
  {
    value: "hypertrophy",
    labelKey: "wizard.goal.hypertrophy.label",
    descriptionKey: "wizard.goal.hypertrophy.desc",
  },
  {
    value: "fat_loss",
    labelKey: "wizard.goal.fatLoss.label",
    descriptionKey: "wizard.goal.fatLoss.desc",
  },
  {
    value: "general_fitness",
    labelKey: "wizard.goal.generalFitness.label",
    descriptionKey: "wizard.goal.generalFitness.desc",
  },
];

export interface LocationOption {
  value: TrainingLocation;
  labelKey: string;
  descriptionKey: string;
}

export const LOCATION_OPTIONS: readonly LocationOption[] = [
  {
    value: "home",
    labelKey: "wizard.location.home.label",
    descriptionKey: "wizard.location.home.desc",
  },
  {
    value: "gym",
    labelKey: "wizard.location.gym.label",
    descriptionKey: "wizard.location.gym.desc",
  },
  {
    value: "outdoor",
    labelKey: "wizard.location.outdoor.label",
    descriptionKey: "wizard.location.outdoor.desc",
  },
];

export const FREQUENCY_OPTIONS: readonly number[] = [2, 3, 4, 5, 6];

export const DURATION_OPTIONS: readonly number[] = [15, 30, 45, 60, 90];

export interface EquipmentOption {
  value: string;
  labelKey: string;
}

/** Equipment catalogue, scoped by training location. */
export const EQUIPMENT_BY_LOCATION: Record<TrainingLocation, EquipmentOption[]> = {
  home: [
    { value: "dumbbells", labelKey: "wizard.equipment.dumbbells.label" },
    { value: "resistance_bands", labelKey: "wizard.equipment.resistanceBands.label" },
    { value: "pull_up_bar", labelKey: "wizard.equipment.pullUpBar.label" },
    { value: "kettlebell", labelKey: "wizard.equipment.kettlebell.label" },
    { value: "bench", labelKey: "wizard.equipment.bench.label" },
  ],
  gym: [
    { value: "barbell", labelKey: "wizard.equipment.barbell.label" },
    { value: "dumbbells", labelKey: "wizard.equipment.dumbbells.label" },
    { value: "cable_machine", labelKey: "wizard.equipment.cableMachine.label" },
    { value: "smith_machine", labelKey: "wizard.equipment.smithMachine.label" },
    { value: "leg_press", labelKey: "wizard.equipment.legPress.label" },
    { value: "bench", labelKey: "wizard.equipment.bench.label" },
  ],
  outdoor: [
    { value: "resistance_bands", labelKey: "wizard.equipment.resistanceBands.label" },
    { value: "pull_up_bar", labelKey: "wizard.equipment.pullUpBar.label" },
    { value: "bodyweight", labelKey: "wizard.equipment.bodyweight.label" },
    { value: "suspension_trainer", labelKey: "wizard.equipment.suspensionTrainer.label" },
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
    altKey: "wizard.equipment.dumbbells.alt",
  },
  barbell: {
    src: "/equipment/equip-barras.webp",
    altKey: "wizard.equipment.barbell.alt",
  },
  resistance_bands: {
    src: "/equipment/equip-bandas.webp",
    altKey: "wizard.equipment.resistanceBands.alt",
  },
  bodyweight: {
    src: "/equipment/equip-peso-corporal.webp",
    altKey: "wizard.equipment.bodyweight.alt",
  },
  cable_machine: {
    src: "/equipment/equip-maquinas.webp",
    altKey: "wizard.equipment.cableMachine.alt",
  },
  pull_up_bar: {
    src: "/equipment/equip-dominadas.webp",
    altKey: "wizard.equipment.pullUpBar.alt",
  },
  kettlebell: {
    src: "/equipment/equip-kettlebell.webp",
    altKey: "wizard.equipment.kettlebell.alt",
  },
  bench: {
    src: "/equipment/equip-banco.webp",
    altKey: "wizard.equipment.bench.alt",
  },
  leg_press: {
    src: "/equipment/equip-prensa.webp",
    altKey: "wizard.equipment.legPress.alt",
  },
  suspension_trainer: {
    src: "/equipment/equip-trx.webp",
    altKey: "wizard.equipment.suspensionTrainer.alt",
  },
  smith_machine: {
    src: "/equipment/equip-gimnasio.webp",
    altKey: "wizard.equipment.smithMachine.alt",
  },
};

export function equipmentPhotoForValue(value: string): EquipmentPhoto | undefined {
  return EQUIPMENT_PHOTO_BY_VALUE[value];
}
