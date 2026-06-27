import type { PlanGoal, PlanPreferenceScores, PlanSpec } from "@kinora/contracts";

type DeriveInput = Pick<
  PlanSpec,
  "goal" | "daysPerWeek" | "sessionDurationMinutes" | "location" | "equipment" | "limitations"
>;

/**
 * Base preference score table by training goal.
 * Values are the starting point before modifiers are applied.
 */
const BASE_SCORES: Record<PlanGoal, PlanPreferenceScores> = {
  strength:        { strength: 0.9, hypertrophy: 0.6, endurance: 0.2, mobility: 0.3 },
  hypertrophy:     { strength: 0.6, hypertrophy: 0.9, endurance: 0.3, mobility: 0.3 },
  fat_loss:        { strength: 0.4, hypertrophy: 0.5, endurance: 0.9, mobility: 0.4 },
  general_fitness: { strength: 0.5, hypertrophy: 0.5, endurance: 0.6, mobility: 0.6 },
};

function clamp(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/**
 * Derives preference scores deterministically from a PlanSpec's training parameters.
 *
 * Pure function — no side effects, no I/O.
 * Called server-side at promote (source of truth) and mirrored client-side for preview.
 *
 * Design reference: design.md §2 preferenceScores Derivation.
 */
export function derivePreferenceScores(spec: DeriveInput): PlanPreferenceScores {
  const base = BASE_SCORES[spec.goal];

  let strength = base.strength;
  let hypertrophy = base.hypertrophy;
  let endurance = base.endurance;
  let mobility = base.mobility;

  // Modifiers — applied in order, each independent
  if (spec.daysPerWeek >= 5) {
    endurance += 0.1;
  }

  if (spec.sessionDurationMinutes <= 30) {
    endurance += 0.1;
    hypertrophy -= 0.1;
  }

  if (spec.location === "outdoor") {
    endurance += 0.1;
    mobility += 0.1;
  }

  if (spec.equipment.length === 0) {
    strength -= 0.1;
    mobility += 0.1;
  }

  if (spec.limitations.length > 0) {
    mobility += 0.1;
  }

  return {
    strength: clamp(strength),
    hypertrophy: clamp(hypertrophy),
    endurance: clamp(endurance),
    mobility: clamp(mobility),
  };
}
