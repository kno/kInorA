/**
 * Bridges the wizard's equipment vocabulary to the exercise catalog's, and
 * derives the set of exercises a given user can actually perform (#352 slice B).
 *
 * Generation currently invents its exercise names as free text, so the wizard's
 * equipment answers are a hint the model may ignore. Handing it a concrete
 * allowed list turns them into a guarantee — but only if the list is correct,
 * which is harder than it looks because the two vocabularies do not line up.
 *
 * ## Why a plain mapping table is not enough
 *
 * The wizard has 11 equipment values; the catalog has 28. Most pair off
 * cleanly (`dumbbells` -> `dumbbell`, `cable_machine` -> `cable`). Three do
 * not, and each fails differently:
 *
 *  - **`pull_up_bar` has no catalog equipment.** Pull-ups are filed under
 *    `body weight`. Since bodyweight exercises are otherwise always available,
 *    a naive mapping would prescribe pull-ups to someone with no bar — the
 *    exact failure this slice exists to prevent. Measured: 33 of the 325
 *    `body weight` records need a bar.
 *  - **`bench` has no catalog equipment either**, and cannot have one: the 72
 *    records with "bench" in the name span EIGHT different equipment values
 *    (`barbell`, `body weight`, `cable`, `dumbbell`, `ez barbell`,
 *    `smith machine`, `weighted`, `band`). The bench is implied by the
 *    movement, never by the equipment field.
 *  - **`suspension_trainer` has no catalog records at all.** Selecting it
 *    grants nothing. Saying so explicitly beats silently mapping it to
 *    something adjacent and prescribing the wrong movement.
 *
 * So the vocabulary is a mapping table PLUS name-level rules for what the
 * catalog's equipment field cannot express. The name rules only ever REMOVE
 * exercises: a rule that is too aggressive costs variety, whereas a missing
 * rule prescribes a movement the user physically cannot do.
 */
import { listExercises } from "@kinora/exercise-catalog";
import type { ExerciseCatalogRecord } from "@kinora/exercise-catalog";

/**
 * Catalog `equipment` values unlocked by each wizard equipment value.
 *
 * Keys are the strings the wizard persists into `PlanSpec.equipment`
 * (`apps/web/src/components/wizard/options.ts`). A value mapping to an empty
 * list is deliberate and documented above — it unlocks no catalog equipment
 * and is handled by the name rules instead, or grants nothing at all.
 */
const EQUIPMENT_TO_CATALOG: Readonly<Record<string, readonly string[]>> = {
  bodyweight: ["body weight"],
  dumbbells: ["dumbbell"],
  // The catalog splits the barbell family by bar type; a user who has "a
  // barbell" can use any of them.
  barbell: ["barbell", "ez barbell", "olympic barbell", "trap bar"],
  kettlebell: ["kettlebell"],
  cable_machine: ["cable"],
  smith_machine: ["smith machine"],
  // The catalog carries BOTH `band` (54 records) and `resistance band` (7) for
  // the same physical object — an upstream inconsistency, not two categories.
  resistance_bands: ["band", "resistance band"],
  // A leg press is a loaded sled; the catalog files these under the machine
  // family rather than a dedicated value.
  leg_press: ["sled machine", "leverage machine"],
  // No catalog equipment — see the module comment. Handled by name rules.
  pull_up_bar: [],
  bench: [],
  suspension_trainer: [],
};

/** Every wizard equipment value this module knows how to interpret. */
export const KNOWN_EQUIPMENT_VALUES: readonly string[] = Object.keys(EQUIPMENT_TO_CATALOG);

/**
 * Bodyweight exercises that nonetheless need something to hang from. Matched on
 * the name because the catalog's equipment field says only `body weight`.
 *
 * `hang`/`hanging` is included deliberately: a hanging leg raise needs the same
 * bar a pull-up does, even though nothing in its name says "pull".
 */
const NEEDS_A_BAR = /\b(pull[- ]?ups?|chin[- ]?ups?|muscle[- ]?ups?|hanging|hang)\b/i;

/**
 * Exercises performed on a bench. Matched on the name because "bench" is not an
 * equipment value and the records that need one are spread across eight of
 * them.
 */
const NEEDS_A_BENCH = /\bbench\b/i;

/**
 * `body weight` is unlocked unconditionally: a user always has their own body,
 * whether or not they ticked the "bodyweight" box. Without this, someone who
 * selected only "dumbbells" would get a plan with no bodyweight movement in it
 * at all, which is not what they asked for and not good programming.
 */
const ALWAYS_AVAILABLE = "body weight";

/**
 * Wizard values that unlock nothing through the equipment table but DO change
 * the result, by lifting one of the name rules above. Without this set they
 * would be misreported as ignored — `pull_up_bar` adds 33 exercises and
 * `bench` adds 72, so calling them ignored would be plainly false.
 */
const GRANTS_VIA_NAME_RULE: ReadonlySet<string> = new Set(["pull_up_bar", "bench"]);

/** What a set of wizard equipment answers resolves to. */
export interface ExerciseVocabulary {
  /** Catalog records the user can perform, in catalog order. */
  exercises: ExerciseCatalogRecord[];
  /**
   * Wizard values that were supplied but unlock nothing — either unknown to
   * this module, or known-but-unrepresentable (`suspension_trainer`). Surfaced
   * rather than swallowed so a vocabulary that silently shrinks is visible.
   */
  ignoredEquipment: string[];
}

/**
 * Resolves the exercises a user can perform from their wizard equipment answers.
 *
 * Empty or absent equipment is NOT an error: it means bodyweight-only, which is
 * a legitimate and common answer, and it yields the bodyweight catalog minus
 * whatever needs a bar or a bench.
 *
 * Never throws. Unknown equipment values are reported in `ignoredEquipment`
 * rather than rejected — a wizard option added without updating this table must
 * degrade to "grants nothing", never to a crash on the generation path.
 */
export function resolveExerciseVocabulary(
  equipment: readonly string[] = [],
): ExerciseVocabulary {
  const declared = new Set(
    equipment.filter((value): value is string => typeof value === "string" && value !== ""),
  );

  // Ignored means "changed nothing at all": neither unlocked catalog equipment
  // nor lifted a name rule. `suspension_trainer` and unknown values only.
  const ignoredEquipment = [...declared]
    .filter(
      (value) =>
        (EQUIPMENT_TO_CATALOG[value] ?? []).length === 0 && !GRANTS_VIA_NAME_RULE.has(value),
    )
    .sort();

  const allowedEquipment = new Set<string>([ALWAYS_AVAILABLE]);
  for (const value of declared) {
    for (const catalogValue of EQUIPMENT_TO_CATALOG[value] ?? []) {
      allowedEquipment.add(catalogValue);
    }
  }

  const hasBar = declared.has("pull_up_bar");
  const hasBench = declared.has("bench");

  const exercises = listExercises().items.filter((record) => {
    if (!allowedEquipment.has(record.equipment)) {
      return false;
    }
    if (!hasBar && NEEDS_A_BAR.test(record.name)) {
      return false;
    }
    if (!hasBench && NEEDS_A_BENCH.test(record.name)) {
      return false;
    }
    return true;
  });

  return { exercises, ignoredEquipment };
}
