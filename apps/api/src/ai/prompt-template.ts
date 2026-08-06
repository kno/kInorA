/**
 * `{{variable}}` literal-substitution renderer (langfuse-prompt-management, slice B1).
 *
 * Deliberately NOT Mustache/Handlebars/LangChain `PromptTemplate`: no conditionals,
 * no loops, no partials. Every builder already pre-composes its conditional wording
 * into section strings (`memorySection`, `vocabularySection`, `taskExerciseRule`),
 * so the renderer only ever does a flat find/replace. This also avoids LangChain
 * templating reinterpreting the JSON braces in the output-format block.
 *
 * Pure, synchronous, total: never throws, no I/O. Both the local template path and
 * (from slice B2) the remote-fetched template run through this SAME function, so
 * local and remote prompts are rendered identically.
 */

/** Literal opening delimiter of a template marker. */
export const TEMPLATE_MARKER_OPEN = "{{";

/**
 * A prompt's compiled-in shape: its local fallback template plus the CLOSED
 * variable set and marker contract a remote template must also satisfy
 * (validated in slice B2's `remote-template-validation.ts`).
 */
export interface PromptDefinition {
  /** Langfuse prompt name, e.g. "kinora-plan-generation". */
  name: string;
  /** The exported compiled-in constant — today's exact wording. */
  localTemplate: string;
  /** The CLOSED variable set the producer supplies. */
  variables: readonly string[];
  /** Markers that MUST be present, e.g. "{{vocabularySection}}", "TASK:". */
  requiredMarkers: readonly string[];
  /** Markers that MUST appear in THIS relative order. */
  orderedMarkers: readonly string[];
  /** Hard size cap on a remote template payload. */
  maxTemplateChars: number;
}

/**
 * Replaces every `{{name}}` occurrence in `template` with `variables[name]`.
 * A marker with no matching key is left intact (untouched), so a later
 * validation pass (`unresolved_marker_after_render`, slice B2) can still find it.
 */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [name, value] of Object.entries(variables)) {
    result = result.split(`${TEMPLATE_MARKER_OPEN}${name}}}`).join(value);
  }
  return result;
}

/** Extracts every distinct `{{variable}}` name referenced in `template`, in first-seen order. */
export function templateVariablesOf(template: string): string[] {
  const seen = new Set<string>();
  const pattern = /\{\{(\w+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    seen.add(match[1] as string);
  }
  return [...seen];
}
