import type { ChatExtractInput } from "./extraction-port.js";
import { sanitizeMemoryContext } from "./prompt.js";
import { renderTemplate, type PromptDefinition } from "./prompt-template.js";

/**
 * Builds the prompts for one conversational create-plan turn
 * (12-interactive-text-chat). TWO pure builders, one per LLM pass:
 *
 * - `buildReplyPrompt(input)` — Pass 1, the CONVERSATIONAL prompt that streams
 *   the assistant's natural-language reply token-by-token.
 * - `buildExtractionPrompt(input, assistantReply)` — Pass 2, the EXTRACTION
 *   prompt seeded with Pass 1's reply so the extracted wizard fields are
 *   CONSISTENT with what the assistant just told the user.
 *
 * Pure functions — no network, no side effects. Both return UNMASKED text
 * (langfuse-prompt-management, slice B1): masking moved OUT of these builders
 * and now runs on the RENDERED string at the invocation site
 * (`extraction-adapter.ts`), exactly as `invokeChain` already does for the
 * plan prompt — one masking rule, no path where a template can bypass it.
 *
 * ACCURATE masking guarantee (do NOT overstate this — enforced by the CALLER,
 * not by these functions):
 * - Limitation/health terms ALREADY KNOWN in `currentDraft.limitations` are
 *   redacted from the WHOLE assembled prompt via `mask(text, limitationTermsOf(input))`
 *   at the call site — this also scrubs a repeat of the SAME known term if the
 *   user mentions it again this turn, AND (for Pass 2) any occurrence inside
 *   the seeded `assistantReply`.
 * - A user's NEWLY INTRODUCED (first-mention) health/limitation text in
 *   `message` is NOT masked and is necessarily visible to the model this
 *   turn — extraction cannot read a field it cannot see. This is unavoidable
 *   and intentional, not a leak: raw health text reaching the LLM call for a
 *   first mention is the expected, minimal necessary exposure for the feature
 *   to work.
 * - Approved memory context is scrubbed of prompt-injection / medical-advice
 *   patterns via `sanitizeMemoryContext()` before inclusion (unaffected by the
 *   masking relocation — it runs in the variables producer, not the renderer).
 *
 * The DURABLE privacy guarantees for chat/extraction live elsewhere, not in
 * these functions:
 * (a) chat transcripts are NEVER embedded into the vector store (raw-transcript
 *     embedding is out of scope for this feature entirely);
 * (b) observability/tracing (Langfuse) masking for the LLM calls is enforced by
 *     the extraction adapter (`extraction-adapter.ts`), which masks the
 *     RENDERED text before it reaches the model/callback, even though that
 *     text necessarily contains a first-mention phrase this masking cannot redact;
 * (c) `buildPlanPrompt` (plan GENERATION, a separate call after promote/confirm)
 *     is masked at its own call site (`adapter-factory.ts`'s `invokeChain`)
 *     with the full, by-then-known limitations list before generation.
 */

/** Internal-context sections shared by both passes (draft/missing/memory). */
function buildContextSections(input: ChatExtractInput): {
  knownSection: string;
  missingSection: string;
  memorySection: string;
} {
  const { currentDraft, missingFields, memoryContext } = input;

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

  return { knownSection, missingSection, memorySection };
}

/** Known limitation terms to mask from the assembled prompt for BOTH passes. */
export function limitationTermsOf(input: ChatExtractInput): string[] {
  return (input.currentDraft.limitations ?? []).map((l) => l.text);
}

/**
 * Today's exact Pass-1 (conversational reply) wording, compiled in as a
 * `{{variable}}` template (langfuse-prompt-management, slice B1).
 */
export const REPLY_PROMPT_TEMPLATE = `You are a fitness plan assistant helping a user describe a workout plan through conversation.

IMPORTANT — SAFETY AND SCOPE RULES:
- Do not diagnose any medical condition.
- Do not provide medical advice.
- Treat all physical considerations as self-reported context only.
- Always recommend consulting a qualified professional for medical concerns.
- This is not a medical tool.

CONVERSATION STYLE:
- Reply in the SAME language the user writes in. Detect it from their message and mirror it; if they switch languages, switch with them.
- Use a neutral register of that language. Do NOT use regional idioms or dialect-specific grammar (for example, voseo in Spanish) UNLESS the user uses them first, in which case you may match their style.
- Ask ONLY ONE question at a time. Never stack multiple questions in a single reply, even when several fields are still missing — pick the single most useful thing to ask next.
- Sound like a real, warm person who genuinely cares about helping — natural and conversational, never robotic, mechanical, or form-like. Acknowledge what the user just said before moving on.
- The "CURRENT DRAFT" and "STILL MISSING" blocks below are INTERNAL context to guide you only. NEVER repeat, quote, echo, list, or mention them (or field names like goal/daysPerWeek) in your reply. Reply with natural conversation ONLY — no headings, no bullet lists, no field dumps.
- Be a real coach, not a form. If the user asks you to decide ("what do you recommend?", "you choose"), or is unsure, DO NOT bounce the same question back — propose ONE concrete, sensible default for the field in question (e.g. for fat loss, 3-4 days a week of 40-45 min is a reasonable starting point), briefly say why in a sentence, and invite them to confirm or adjust. Never repeat the exact same question you just asked; if the user already answered or pushed back, move forward.

TASK:
Reply to the user with a single natural-language message (plain prose only — no JSON, no field names, no headings). Follow ALL the CONVERSATION STYLE rules above. Whatever concrete value you propose or state in your reply (for example a specific number of training days or session length), be consistent with it for the rest of the turn.

{{knownSection}}

{{missingSection}}

USER MESSAGE:
{{message}}{{memorySection}}`;

/** Closed variable set + marker contract for `kinora-chat-reply`. */
export const REPLY_PROMPT_DEFINITION: PromptDefinition = {
  name: "kinora-chat-reply",
  localTemplate: REPLY_PROMPT_TEMPLATE,
  variables: ["knownSection", "missingSection", "message", "memorySection"],
  requiredMarkers: ["{{knownSection}}", "{{missingSection}}", "{{message}}", "{{memorySection}}"],
  orderedMarkers: ["{{knownSection}}", "{{missingSection}}", "{{message}}"],
  maxTemplateChars: 20_000,
};

/**
 * Today's exact Pass-2 (extraction) wording, compiled in as a `{{variable}}`
 * template (langfuse-prompt-management, slice B1).
 */
export const EXTRACTION_PROMPT_TEMPLATE = `You are a fitness plan assistant extracting structured plan-spec fields from a conversation.

IMPORTANT — SAFETY AND SCOPE RULES:
- Do not diagnose any medical condition.
- Do not provide medical advice.
- Treat all physical considerations as self-reported context only.
- This is not a medical tool.

TASK:
From the conversation below, extract ONLY these wizard input fields (leave a field absent if the conversation does not clearly specify it):
- goal: one of strength | hypertrophy | fat_loss | general_fitness
- daysPerWeek: integer 1..7
- sessionDurationMinutes: integer 15..240
- location: one of home | gym | outdoor
- equipment: list of equipment names
- limitations: list of self-reported physical considerations
- name (optional): a user-chosen plan name
Extract values CONSISTENT with the WHOLE conversation, INCLUDING any concrete value the assistant proposed or stated in its reply below — so the extracted draft matches what the assistant just told the user (e.g. if the assistant recommended "3 days a week", extract daysPerWeek = 3).
NEVER infer preferenceScores or confirmed — those are derived and controlled server-side.

{{knownSection}}

{{missingSection}}

ASSISTANT REPLY (you just told the user this — extract values CONSISTENT with it):
{{assistantReply}}

USER MESSAGE:
{{message}}{{memorySection}}`;

/** Closed variable set + marker contract for `kinora-chat-extraction`. */
export const EXTRACTION_PROMPT_DEFINITION: PromptDefinition = {
  name: "kinora-chat-extraction",
  localTemplate: EXTRACTION_PROMPT_TEMPLATE,
  variables: ["knownSection", "missingSection", "assistantReply", "message", "memorySection"],
  requiredMarkers: [
    "{{knownSection}}",
    "{{missingSection}}",
    "{{assistantReply}}",
    "{{message}}",
    "{{memorySection}}",
  ],
  orderedMarkers: ["{{knownSection}}", "{{missingSection}}", "{{assistantReply}}", "{{message}}"],
  maxTemplateChars: 20_000,
};

/** Computes the CLOSED variable set `REPLY_PROMPT_TEMPLATE` renders over. */
export function buildReplyPromptVariables(input: ChatExtractInput): Record<string, string> {
  const { message } = input;
  const { knownSection, missingSection, memorySection } = buildContextSections(input);
  return { knownSection, missingSection, message, memorySection };
}

/** Computes the CLOSED variable set `EXTRACTION_PROMPT_TEMPLATE` renders over. */
export function buildExtractionPromptVariables(
  input: ChatExtractInput,
  assistantReply: string,
): Record<string, string> {
  const { message } = input;
  const { knownSection, missingSection, memorySection } = buildContextSections(input);
  return { knownSection, missingSection, assistantReply, message, memorySection };
}

/**
 * Pass 1 — the CONVERSATIONAL prompt. Streams the assistant's natural-language
 * reply token-by-token. The CURRENT DRAFT / STILL MISSING blocks are INTERNAL
 * context so the assistant knows what to ask about; the reply itself MUST be
 * plain prose (NOT JSON, no `assistantMessage` field — this call is not
 * structured).
 *
 * Thin wrapper: renders `REPLY_PROMPT_TEMPLATE` over `buildReplyPromptVariables(input)`.
 *
 * Returns UNMASKED text (langfuse-prompt-management, slice B1 — masking
 * relocated to the invocation site in `extraction-adapter.ts`, mirroring
 * `invokeChain`'s A1 wiring, so there is exactly one masking rule with no
 * path where a template can bypass it). Callers MUST mask the returned text
 * with `mask(text, limitationTermsOf(input))` before it reaches a model or an
 * observability callback.
 */
export function buildReplyPrompt(input: ChatExtractInput): string {
  return renderTemplate(REPLY_PROMPT_TEMPLATE, buildReplyPromptVariables(input)).trim();
}

/**
 * Pass 2 — the EXTRACTION prompt, seeded with Pass 1's `assistantReply`. Asks
 * the model to extract ONLY the wizard input fields, and to keep them CONSISTENT
 * with the whole conversation INCLUDING any concrete value the assistant just
 * proposed/stated in its reply — so the committed draft matches the reply.
 *
 * Thin wrapper: renders `EXTRACTION_PROMPT_TEMPLATE` over
 * `buildExtractionPromptVariables(input, assistantReply)`.
 *
 * Returns UNMASKED text — see `buildReplyPrompt`'s docstring; the same
 * relocation applies here, including the seeded `assistantReply`.
 */
export function buildExtractionPrompt(input: ChatExtractInput, assistantReply: string): string {
  return renderTemplate(
    EXTRACTION_PROMPT_TEMPLATE,
    buildExtractionPromptVariables(input, assistantReply),
  ).trim();
}
