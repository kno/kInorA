import { z } from "zod";
import { TEMPLATE_MARKER_OPEN, templateVariablesOf, type PromptDefinition } from "./prompt-template.js";

/**
 * Untrusted-remote-template validation (langfuse-prompt-management, slice B2).
 *
 * A template fetched from Langfuse is third-party input and MUST be rejected
 * — never repaired — when it violates any part of the boundary contract.
 * `no_credentials`, `fetch_failed` and `prompt_not_found` are NOT produced
 * here: they are provider-level reasons `ResolvePrompt` (`prompt-provider.ts`)
 * assigns when the gateway itself fails before a payload ever reaches this
 * validator.
 */
export type PromptRejectionReason =
  | "no_credentials"
  | "fetch_failed"
  | "prompt_not_found"
  | "payload_not_string"
  | "payload_empty"
  | "payload_too_large"
  | "unknown_variable"
  | "missing_required_placeholder"
  | "marker_order_violated"
  | "unresolved_marker_after_render";

export type TemplateValidationResult =
  | { ok: true; template: string }
  | { ok: false; reason: PromptRejectionReason };

/** Boundary schema for a fetched template payload, sized per `def.maxTemplateChars`. */
export function RemoteTemplateSchema(def: PromptDefinition) {
  return z.string().min(1).max(def.maxTemplateChars);
}

/**
 * Validates a fetched template payload against `def`'s closed contract, in
 * order, first failure wins:
 *   1. payload shape (non-string / empty / over size cap)
 *   2. every referenced `{{variable}}` is in the CLOSED `def.variables` set
 *   3. every `def.requiredMarkers` is present
 *   4. `def.orderedMarkers` appear in strictly increasing order
 *
 * Step 5 of the design's algorithm (post-render `{{` sweep) is NOT done here
 * — it requires the actual rendered output, which only exists once the
 * template is rendered with real variable values. See {@link checkRenderedTemplate}.
 */
export function validateRemoteTemplate(
  def: PromptDefinition,
  payload: unknown
): TemplateValidationResult {
  const parsed = RemoteTemplateSchema(def).safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.code === "too_small") return { ok: false, reason: "payload_empty" };
    if (issue?.code === "too_big") return { ok: false, reason: "payload_too_large" };
    return { ok: false, reason: "payload_not_string" };
  }
  const template = parsed.data;

  const closedSet = new Set(def.variables);
  const referenced = templateVariablesOf(template);
  if (referenced.some((name) => !closedSet.has(name))) {
    return { ok: false, reason: "unknown_variable" };
  }

  if (!def.requiredMarkers.every((marker) => template.includes(marker))) {
    return { ok: false, reason: "missing_required_placeholder" };
  }

  const indices = def.orderedMarkers.map((marker) => template.indexOf(marker));
  for (let i = 1; i < indices.length; i++) {
    if (!(indices[i]! > indices[i - 1]!)) {
      return { ok: false, reason: "marker_order_violated" };
    }
  }

  return { ok: true, template };
}

/**
 * Drift detection (#390): the declared variables of `def` that the accepted
 * remote `template` does NOT reference, in `def.variables` order.
 *
 * This is deliberately NOT part of {@link validateRemoteTemplate}. A variable
 * may be legitimately absent from a remote template — an optional section a
 * prompt owner chose not to render — so a missing variable must never reject
 * the template. It is, however, exactly the shape of the silent failure this
 * function exists to surface: a repository template gains a variable, the
 * Langfuse-hosted template is never updated by hand, and the remote template
 * keeps validating cleanly while the new data reaches nothing. The caller
 * (`ResolvePrompt`) reports the gap as an observability event and serves the
 * remote template regardless.
 */
export function missingRemoteVariables(def: PromptDefinition, template: string): string[] {
  const referenced = new Set(templateVariablesOf(template));
  return def.variables.filter((name) => !referenced.has(name));
}

/**
 * Post-render sweep (validation algorithm step 5): a residual `{{` in the
 * RENDERED output means a marker survived rendering unresolved — e.g. a
 * malformed marker (stray whitespace inside the braces) that
 * `templateVariablesOf` could not recognize as a variable reference, so it
 * passed {@link validateRemoteTemplate} but was never substituted.
 */
export function checkRenderedTemplate(
  rendered: string
): { ok: true } | { ok: false; reason: "unresolved_marker_after_render" } {
  return rendered.includes(TEMPLATE_MARKER_OPEN)
    ? { ok: false, reason: "unresolved_marker_after_render" }
    : { ok: true };
}
