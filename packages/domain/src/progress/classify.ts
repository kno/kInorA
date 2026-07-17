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
 * Matching runs in two passes over `KEYWORD_GROUPS`, both against the
 * normalized title (see `normalizeTitle`):
 *
 *   1. SPECIFIC pass — every group's `specific` phrases are checked first,
 *      across ALL groups, before any `bare` keyword is considered. This
 *      guarantees a specific, unambiguous phrase always wins over a shorter/
 *      more generic keyword from a different (wrong) bucket, regardless of
 *      group order — e.g. "reverse fly" / "rear delt fly" (shoulders) is
 *      matched before chest's bare "fly" is ever consulted, and "leg curl" /
 *      "curl femoral" (hamstrings) are matched before biceps' bare "curl"
 *      fallback (below) ever runs.
 *   2. BARE pass — only once no specific phrase matched anywhere do the
 *      generic/short `bare` keywords run, in group order. This is where the
 *      bare "curl" -> biceps fallback lives (catches Barbell/Preacher/
 *      Concentration/Cable Curl), and where bare "deadlift" / "peso muerto"
 *      -> hamstrings lives (catches every deadlift variant uniformly, see
 *      "Deadlift taxonomy decision" below), and where bare "row" -> back
 *      lives (catches Dumbbell/Seated/Cable/T-Bar/Pendlay/Barbell Row; the
 *      shoulders-specific "upright row" phrase above already won for that
 *      one exception).
 *
 * Deadlift taxonomy decision: ALL deadlift variants — conventional, Romanian,
 * sumo, stiff-leg, trap-bar — classify as `hamstrings`, not `back`. Rationale:
 * the hip hinge's prime movers are the hamstrings/glutes; the back
 * (erectors/lats) works isometrically as a stabilizer, not the prime mover.
 * This is a documented, deliberate choice (see classify.test.ts's "deadlift
 * variants" block) — it is never left ambiguous or silently split by variant.
 *
 * Spanish plurals: common ES plural forms are matched by whichever of two
 * mechanisms applies —
 *   - Single-word keywords whose plural just appends -s/-es (e.g.
 *     "sentadilla" -> "sentadillas", "dominada" -> "dominadas", "flexion" ->
 *     "flexiones") already match via plain substring containment, since the
 *     singular is a textual prefix of the plural — no extra keyword needed.
 *   - Multi-word phrases pluralize their first word mid-phrase (e.g.
 *     "elevacion lateral" -> "elevaciones laterales"), which breaks prefix
 *     containment, so those get an explicit plural keyword alongside the
 *     singular.
 *
 * Word-boundary matching (Round-2 Judgment Day fix): keywords are matched
 * against the normalized title using a `\b`-anchored regular expression, not
 * raw substring containment. Plain `.includes()` let short bare keywords
 * match INSIDE unrelated words — e.g. bare "row" (back) is a substring of
 * "throw", "narrow", "arrow", "crow"; bare "rdl" (hamstrings) is a substring
 * of "hurdle"/"girdle"; bare ES "remo" (back) is a substring of "extremo";
 * bare "core" is a substring of "scorecard" — all producing a confidently
 * WRONG bucket, worse than degrading to `null`. Word-boundary anchoring
 * eliminates this entire class of false positive at the matching primitive,
 * rather than patching each offending keyword individually.
 *
 * Because `normalizeTitle` already replaces hyphens with spaces (see
 * normalize.ts), keywords never need a hyphenated form — "push up" matches
 * "Push-up", "Push up", and "Pushup"-adjacent phrases (e.g. "Narrow Grip
 * Push-up") uniformly once normalized.
 *
 * Spanish plural suffix: the compiled regex also allows an optional
 * trailing "s" or "es" (`(?:e?s)?`) after the keyword, still anchored by the
 * closing `\b`. This preserves the plural matches documented above
 * ("sentadilla" -> "sentadillas", "dominada" -> "dominadas", "flexion" ->
 * "flexiones") which relied on plain substring/prefix containment before
 * this fix and would otherwise regress under strict `\b` anchoring (a
 * trailing "s"/"es" is itself a word character, so it sits on the wrong side
 * of a strict end boundary). The suffix is a fixed literal alternative, not
 * a wildcard, so it does not reintroduce the substring bug: the *start*
 * boundary check (which is what rejects "extremo", "hurdle", etc.) is
 * unaffected by this change.
 *
 * Unmapped titles degrade to `null` — intentional, never thrown.
 *
 * Pure — no I/O.
 */
interface KeywordGroup {
  readonly group: MuscleGroup;
  /** Specific phrases checked (across all groups) before any bare keyword. */
  readonly specific: readonly string[];
  /** Generic/short fallback keywords, checked (in group order) only once no specific phrase matched. */
  readonly bare: readonly string[];
}

const KEYWORD_GROUPS: readonly KeywordGroup[] = [
  {
    group: "hamstrings",
    // "leg curl" / "curl femoral" contain "curl" and must win over biceps'
    // bare "curl" fallback below — hence specific, checked in pass 1.
    specific: ["leg curl", "curl femoral", "curl de femoral"],
    // Bare "deadlift" / "peso muerto" catch every variant (conventional,
    // Romanian, sumo, stiff-leg, trap-bar) uniformly — see taxonomy decision above.
    bare: [
      "deadlift",
      "peso muerto",
      "rdl",
      "femoral",
      "hamstring",
      "isquiosurales",
      "isquiotibiales",
    ],
  },
  {
    group: "quads",
    specific: [],
    bare: [
      "squat",
      "leg press",
      "leg extension",
      "lunge",
      "sentadilla",
      "prensa de piernas",
      "extension de pierna",
      "extensiones de pierna",
      "zancada",
      "estocada",
      "cuadriceps",
    ],
  },
  {
    group: "calves",
    specific: [],
    bare: ["calf raise", "calf", "elevacion de talones", "elevaciones de talones", "gemelos", "pantorrilla"],
  },
  {
    group: "glutes",
    specific: [],
    bare: [
      "hip thrust",
      "glute bridge",
      "puente de gluteos",
      "puentes de gluteos",
      "patada de gluteo",
      "patadas de gluteo",
      "gluteos",
      "glutes",
    ],
  },
  {
    group: "chest",
    // Genuine chest flys (no "reverse"/"rear" qualifier) stay bare: the
    // shoulders-specific "reverse fly" / "rear delt fly" / "rear fly" phrases
    // above already intercept the rear-delt movements in pass 1, so by the
    // time pass 2 reaches chest's bare "fly" only real chest flys remain.
    specific: [],
    bare: [
      "bench press",
      "chest press",
      "chest fly",
      "pec deck",
      "pec fly",
      "cable fly",
      "dumbbell fly",
      "press de banca",
      "press plano",
      "press inclinado",
      "press declinado",
      "aperturas",
      "flys",
      "fly",
      "flexion",
      "pecho",
      "push up",
      "pushup",
      "press up",
      "lagartija",
    ],
  },
  {
    group: "shoulders",
    // Must be checked before chest's bare "fly" and back's bare "row".
    specific: ["reverse fly", "rear delt fly", "rear fly", "upright row"],
    bare: [
      "shoulder press",
      "overhead press",
      "military press",
      "press militar",
      "press hombro",
      "lateral raise",
      "front raise",
      "elevacion lateral",
      "elevaciones laterales",
      "elevacion frontal",
      "elevaciones frontales",
      "hombros",
      "hombro",
    ],
  },
  {
    group: "back",
    specific: [],
    // Bare "row" / "remo" catch Dumbbell/Seated/Cable/T-Bar/Pendlay/Barbell
    // Row; "upright row" is already diverted to shoulders in pass 1.
    bare: [
      "lat pulldown",
      "pull-up",
      "pullup",
      "pull up",
      "dominada",
      "jalon al pecho",
      "polea al pecho",
      "remo",
      "row",
      "espalda",
      "back extension",
    ],
  },
  {
    group: "triceps",
    specific: [],
    bare: [
      "tricep extension",
      "triceps extension",
      "extension de triceps",
      "skull crusher",
      "press frances",
      "tricep pushdown",
      "triceps pushdown",
      "pushdown",
      "triceps",
    ],
  },
  {
    group: "biceps",
    specific: [],
    // Bare "curl" is the fallback for any remaining "-curl" title once
    // hamstrings' specific "leg curl" / "curl femoral" have had first refusal.
    bare: ["biceps", "curl"],
  },
  {
    group: "core",
    specific: [],
    bare: ["plank", "plancha", "crunch", "sit-up", "situp", "sit up", "ab wheel", "rueda abdominal", "abdominales", "abdominal", "core"],
  },
];

/** Escapes regex metacharacters so a keyword can be embedded as a literal. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compiled `\b`-anchored keyword regexes, cached per unique keyword string
 * (keywords repeat across the specific/bare passes and across calls, so this
 * avoids recompiling the same pattern). Each pattern is a literal, escaped
 * keyword anchored at both ends, with an optional trailing Spanish plural
 * suffix ("s" or "es") before the closing boundary — see the module-level
 * doc comment ("Spanish plural suffix") for why the suffix is needed and why
 * it is safe.
 */
const keywordRegexCache = new Map<string, RegExp>();

function keywordRegex(keyword: string): RegExp {
  const cached = keywordRegexCache.get(keyword);
  if (cached) {
    return cached;
  }
  const compiled = new RegExp(`\\b${escapeRegex(keyword)}(?:e?s)?\\b`);
  keywordRegexCache.set(keyword, compiled);
  return compiled;
}

function keywordMatches(normalizedTitle: string, keyword: string): boolean {
  return keywordRegex(keyword).test(normalizedTitle);
}

export function classifyExerciseMuscleGroup(title: string): MuscleGroup | null {
  const normalized = normalizeTitle(title);

  for (const { group, specific } of KEYWORD_GROUPS) {
    if (specific.some((keyword) => keywordMatches(normalized, keyword))) {
      return group;
    }
  }

  for (const { group, bare } of KEYWORD_GROUPS) {
    if (bare.some((keyword) => keywordMatches(normalized, keyword))) {
      return group;
    }
  }

  return null;
}
