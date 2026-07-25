import type { ChatExtractInput } from "./extraction-port.js";
import { mask } from "./mask.js";
import { sanitizeMemoryContext } from "./prompt.js";

/**
 * Builds the extraction prompt for one conversational create-plan turn
 * (12-interactive-text-chat, S1).
 *
 * Pure function — no network, no side effects. Mirrors `buildPlanPrompt`'s
 * masking call shape, but the guarantee it provides is NARROWER — see below.
 *
 * ACCURATE masking guarantee (do NOT overstate this):
 * - Limitation/health terms ALREADY KNOWN in `currentDraft.limitations` are
 *   redacted from the WHOLE assembled prompt via `mask()` — this also scrubs
 *   a repeat of the SAME known term if the user mentions it again this turn.
 * - A user's NEWLY INTRODUCED (first-mention) health/limitation text in
 *   `message` is NOT masked here and is necessarily visible to the extractor
 *   this turn — extraction cannot read a field it cannot see. This is
 *   unavoidable and intentional, not a leak: raw health text reaching the
 *   extraction LLM call for a first mention is the expected, minimal
 *   necessary exposure for the feature to work.
 * - Approved memory context is scrubbed of prompt-injection / medical-advice
 *   patterns via `sanitizeMemoryContext()` before inclusion.
 *
 * The DURABLE privacy guarantees for chat/extraction live elsewhere, not in
 * this function:
 * (a) chat transcripts are NEVER embedded into the vector store (raw-transcript
 *     embedding is out of scope for this feature entirely);
 * (b) observability/tracing (Langfuse) masking for the extraction LLM call —
 *     TODO(S2b): the extraction adapter (`extraction-adapter.ts`, S2b) MUST
 *     mask health/limitation text in its Langfuse trace metadata/inputs the
 *     same way `invokeChain` does for plan generation, even though the model
 *     input necessarily contains a first-mention phrase this function cannot
 *     redact;
 * (c) `buildPlanPrompt` (plan GENERATION, a separate call after promote/confirm)
 *     masks the full, by-then-known limitations list before generation.
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

  // Masks only ALREADY-KNOWN limitation terms (see docstring above) — a
  // first-mention health phrase in `message` is NOT covered by this call and
  // reaches the returned prompt verbatim; that phrase is what the extractor
  // needs to see to populate `limitations` on this turn.
  //
  // TODO(S2b): apps/api/src/ai/extraction-adapter.ts MUST mask the equivalent
  // health/limitation text before it reaches Langfuse/observability for the
  // extraction call, mirroring `invokeChain`'s masked-trace discipline — the
  // model input can legitimately contain a first-mention phrase, but the
  // trace/observability payload MUST NOT.
  const limitationTerms = (currentDraft.limitations ?? []).map((l) => l.text);
  return mask(rawPrompt, limitationTerms);
}
