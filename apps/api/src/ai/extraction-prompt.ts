import type { ChatExtractInput } from "./extraction-port.js";
import { mask } from "./mask.js";
import { sanitizeMemoryContext } from "./prompt.js";

/**
 * Builds the extraction prompt for one conversational create-plan turn
 * (12-interactive-text-chat, S1).
 *
 * Pure function — no network, no side effects. Mirrors `buildPlanPrompt`:
 * it assembles the prompt string and then applies the SAME masking discipline
 * before returning, so health/limitation text never reaches the LLM or
 * observability verbatim.
 *
 * Masking discipline:
 * - Limitation/health terms from the current draft are redacted from the WHOLE
 *   assembled prompt via `mask()` — this also scrubs the same terms if the user
 *   repeated them in this turn's message.
 * - Approved memory context is scrubbed of prompt-injection / medical-advice
 *   patterns via `sanitizeMemoryContext()` before inclusion.
 *
 * The prompt asks the model to extract ONLY the six wizard input fields plus an
 * optional name, and to never diagnose or give medical advice.
 */
export function buildExtractionPrompt(input: ChatExtractInput): string {
  const { message, currentDraft, missingFields, memoryContext } = input;

  const knownFields: string[] = [];
  if (currentDraft.goal !== undefined) knownFields.push(`- goal: ${currentDraft.goal}`);
  if (currentDraft.daysPerWeek !== undefined)
    knownFields.push(`- daysPerWeek: ${currentDraft.daysPerWeek}`);
  if (currentDraft.sessionDurationMinutes !== undefined)
    knownFields.push(`- sessionDurationMinutes: ${currentDraft.sessionDurationMinutes}`);
  if (currentDraft.location !== undefined) knownFields.push(`- location: ${currentDraft.location}`);
  if (currentDraft.equipment !== undefined)
    knownFields.push(
      `- equipment: ${
        currentDraft.equipment.length > 0 ? currentDraft.equipment.join(", ") : "(none)"
      }`,
    );
  if (currentDraft.limitations !== undefined && currentDraft.limitations.length > 0)
    knownFields.push(
      `- limitations: ${currentDraft.limitations.map((l) => l.text).join("; ")}`,
    );

  const knownSection =
    knownFields.length > 0
      ? `CURRENT DRAFT (already captured):\n${knownFields.join("\n")}`
      : "CURRENT DRAFT: (empty — nothing captured yet)";

  const missingSection =
    missingFields && missingFields.length > 0
      ? `STILL MISSING (ask a clarifying question for these if the message does not supply them):\n${missingFields
          .map((f) => `- ${f}`)
          .join("\n")}`
      : "STILL MISSING: (none)";

  const safeMemoryContext = sanitizeMemoryContext(memoryContext);
  const memorySection =
    safeMemoryContext && safeMemoryContext.length > 0
      ? `\n\nAPPROVED USER MEMORY (supporting preference context only):\n${safeMemoryContext
          .map((m) => `- ${m}`)
          .join("\n")}`
      : "";

  const rawPrompt = `You are a fitness plan assistant helping a user describe a workout plan through conversation.

IMPORTANT — SAFETY AND SCOPE RULES:
- Do not diagnose any medical condition.
- Do not provide medical advice.
- Treat all physical considerations as self-reported context only.
- Always recommend consulting a qualified professional for medical concerns.
- This is not a medical tool.

TASK:
From the user message, extract ONLY these wizard input fields (leave a field absent if the message does not clearly specify it):
- goal: one of strength | hypertrophy | fat_loss | general_fitness
- daysPerWeek: integer 1..7
- sessionDurationMinutes: integer 15..240
- location: one of home | gym | outdoor
- equipment: list of equipment names
- limitations: list of self-reported physical considerations
- name (optional): a user-chosen plan name
NEVER infer preferenceScores or confirmed — those are derived and controlled server-side.

${knownSection}

${missingSection}

USER MESSAGE:
${message}${memorySection}`.trim();

  const limitationTerms = (currentDraft.limitations ?? []).map((l) => l.text);
  return mask(rawPrompt, limitationTerms);
}
