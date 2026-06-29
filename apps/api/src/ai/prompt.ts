import type { PlanSpec } from "@kinora/contracts";

/**
 * Builds a structured prompt for LLM workout plan generation.
 *
 * Pure function — no network calls, no side effects.
 * Imports only from `@kinora/contracts`.
 *
 * The prompt:
 * - Includes all PlanSpec fields (goal, frequency, duration, equipment, location)
 * - Includes user limitations as context (NOT as diagnoses)
 * - Contains an explicit "do not diagnose / do not provide medical advice" instruction
 * - Does NOT itself emit diagnostic phrasing
 */
export function buildPlanPrompt(spec: PlanSpec): string {
  const equipmentList =
    spec.equipment.length > 0 ? spec.equipment.join(", ") : "bodyweight only (no equipment)";

  const limitationsSection =
    spec.limitations.length > 0
      ? `User context — physical considerations (treat as background context only, NOT as diagnoses):
${spec.limitations.map((l) => `- ${l.text}`).join("\n")}`
      : "User context: No specific physical considerations reported.";

  return `You are a certified personal trainer creating a personalized workout program.

IMPORTANT — SAFETY AND SCOPE RULES:
- Do not diagnose any medical condition.
- Do not provide medical advice.
- Do not use diagnostic language such as attributing conditions or medical findings to the user.
- Treat all physical considerations as self-reported context only.
- Always recommend consulting a qualified professional for medical concerns.
- This is not a medical tool.

USER TRAINING PROFILE:
- Goal: ${spec.goal}
- Training days per week: ${spec.daysPerWeek}
- Session duration: ${spec.sessionDurationMinutes} minutes
- Training location: ${spec.location}
- Available equipment: ${equipmentList}

${limitationsSection}

TASK:
Generate a structured ${spec.daysPerWeek}-day-per-week workout program that:
1. Matches the goal (${spec.goal}) with appropriate rep ranges, sets, and exercise selection.
2. Uses ONLY the available equipment: ${equipmentList}.
3. Fits within ${spec.sessionDurationMinutes}-minute sessions at a ${spec.location} setting.
4. Accounts for the physical considerations listed above by recommending modifications or extra caution where appropriate — never blocking or diagnosing.
5. Returns exactly ${spec.daysPerWeek} weekly sessions (one per training day).

OUTPUT FORMAT:
Return a structured workout program with weeklySessions (array of sessions, one per day) and limitationWarnings (array of advisory strings, empty if no limitations). Each session must include a day number, title, and exercises with name, sets, reps (as a string like "8-12"), restSeconds, and optional notes.`.trim();
}
