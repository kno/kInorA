import type { MuscleGroup } from "@kinora/contracts";
import { normalizeTitle } from "./normalize.js";

/**
 * Bilingual (EN + ES) keyword classifier — 09c-v1-progress-dashboard-stats,
 * Slice 1a. Maps a free-text exercise title to one of the 10 primary
 * `MuscleGroup` buckets (design.md "Muscle-group taxonomy"). ES seeds mirror
 * the OpenDesign muscle-library manifest labels (Pecho, Espalda, Hombros,
 * Bíceps, Tríceps, Core/abdominales, Glúteos, Cuádriceps, Isquiosurales,
 * Gemelos) plus common EN/ES exercise terms.
 *
 * Group order matters: specific multi-word leg/glute/calf phrases are
 * checked before groups with shorter/more generic keywords (e.g. "leg curl"
 * before biceps' "curl", "romanian deadlift" before back's plain "deadlift"),
 * so a specific phrase always wins over a broader substring match.
 *
 * Matching runs against the normalized title (see `normalizeTitle`).
 * Unmapped titles degrade to `null` — intentional, never thrown.
 *
 * Pure — no I/O.
 */
const KEYWORD_GROUPS: ReadonlyArray<readonly [MuscleGroup, readonly string[]]> = [
  ["hamstrings", ["romanian deadlift", "rdl", "peso muerto rumano", "leg curl", "curl femoral", "curl de femoral", "femoral", "hamstring", "isquiosurales", "isquiotibiales"]],
  ["quads", ["squat", "leg press", "leg extension", "lunge", "sentadilla", "prensa de piernas", "extension de pierna", "extensión de pierna", "zancada", "estocada", "cuadriceps", "cuádriceps"]],
  ["calves", ["calf raise", "calf", "elevacion de talones", "elevación de talones", "gemelos", "pantorrilla"]],
  ["glutes", ["hip thrust", "glute bridge", "puente de gluteos", "puente de glúteos", "patada de gluteo", "patada de glúteo", "gluteos", "glúteos", "glutes"]],
  ["chest", ["bench press", "chest press", "chest fly", "pec deck", "press de banca", "press plano", "press inclinado", "press declinado", "aperturas", "flys", "fly", "pecho"]],
  ["shoulders", ["shoulder press", "overhead press", "military press", "press militar", "press hombro", "lateral raise", "front raise", "elevacion lateral", "elevación lateral", "elevacion frontal", "elevación frontal", "hombros", "hombro"]],
  ["back", ["lat pulldown", "pull-up", "pullup", "pull up", "dominada", "jalon al pecho", "jalón al pecho", "polea al pecho", "bent over row", "remo", "deadlift", "peso muerto", "espalda", "back extension"]],
  ["triceps", ["tricep extension", "triceps extension", "extension de triceps", "extensión de tríceps", "skull crusher", "press frances", "press francés", "tricep pushdown", "triceps pushdown", "pushdown", "triceps", "tríceps"]],
  ["biceps", ["bicep curl", "biceps curl", "curl de biceps", "curl de bíceps", "hammer curl", "curl martillo", "biceps", "bíceps"]],
  ["core", ["plank", "plancha", "crunch", "sit-up", "situp", "sit up", "ab wheel", "rueda abdominal", "abdominales", "abdominal", "core"]],
];

export function classifyExerciseMuscleGroup(title: string): MuscleGroup | null {
  const normalized = normalizeTitle(title);

  for (const [group, keywords] of KEYWORD_GROUPS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return group;
    }
  }

  return null;
}
