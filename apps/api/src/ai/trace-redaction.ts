/**
 * General-purpose Langfuse trace redaction (17c-profile-body-metrics, PR 3).
 *
 * `mask()` (`./mask.ts`) redacts LITERAL VALUES from the string handed to
 * `.invoke()` — the same string the model reads. That works for limitation
 * terms (the product accepts the model losing them), but it CANNOT work for
 * body metrics: masking before `.invoke()` would remove the values from the
 * model too, cancelling the entire point of feeding them into generation.
 *
 * The model input and the trace input must instead DIVERGE. The only seam
 * where that is possible is the Langfuse SDK's own `mask` hook, supplied at
 * `CallbackHandler` construction (`langfuse-handler.ts`). Verified in the
 * installed `langfuse-core` package: `LangfuseCoreOptions.mask?: MaskFunction`
 * is applied to `input`/`output` ONLY, in-process, at enqueue — before any
 * network call — and FAILS CLOSED on a throw (the whole payload is replaced
 * rather than leaking a partial value).
 *
 * This module is a SPAN-redaction rule engine, not a value list: a rule names
 * a delimited region of prompt text (e.g. `<body_profile>…</body_profile>`)
 * whose CONTENT must never reach a trace, regardless of what that content is.
 * A global `mask` hook cannot know per-request values without async context
 * (rejected — see design.md), but a span rule needs no context at all: it is
 * a pure string transform over whatever the model was actually given.
 *
 * GENERAL BY DESIGN: adding a new class of sensitive prompt content is one
 * entry in `TRACE_REDACTION_RULES` plus matching delimiters in whichever
 * prompt renders it — no change to this module, the handler, or any adapter.
 * #374 (first-mention limitation text reaching the trace) was exactly that:
 * two further entries (`<user_message>` and `<assistant_reply>`) pointed at
 * the same mechanism, with no change to this engine — see design.md
 * "Composition with #374".
 */

/** One span of prompt text that must never leave the process inside a trace. */
export interface TraceRedactionRule {
  /** Opening delimiter, rendered verbatim into the prompt. */
  readonly open: string;
  /** Closing delimiter. */
  readonly close: string;
}

/**
 * Ordered redaction rules applied to every Langfuse trace input/output.
 *
 * - `<body_profile>` (17c): the body-metrics section rendered by
 *   `buildBodyProfileSection` (`prompt.ts`).
 * - `<user_message>` / `<assistant_reply>` (#374): the free text of one chat
 *   turn, wrapped by `buildReplyPromptVariables` /
 *   `buildExtractionPromptVariables` (`extraction-prompt.ts`).
 *
 * The chat rules are deliberately CONTENT-BLIND. `mask()` can only redact
 * limitation terms it already knows, so a limitation stated for the FIRST
 * time travels unmasked through that one turn — and detecting "this is a
 * first-mention turn" before the trace is emitted is impossible, because the
 * extractor only learns the term as a side effect of processing the turn.
 * Redacting the whole region regardless of content sidesteps the detection
 * problem entirely: first mention stops being a special case.
 *
 * The rules are independent and order-free — they operate on disjoint
 * delimiters, so registering one never weakens another.
 */
export const TRACE_REDACTION_RULES: readonly TraceRedactionRule[] = [
  { open: "<body_profile>", close: "</body_profile>" },
  { open: "<user_message>", close: "</user_message>" },
  { open: "<assistant_reply>", close: "</assistant_reply>" },
];

const REDACTED = "[REDACTED]";

/**
 * Replaces every rule's span CONTENT with `[REDACTED]`, leaving the
 * delimiters and everything outside a span byte-identical.
 *
 * Fail-closed on an unterminated span: if an opening delimiter has no
 * matching closing delimiter anywhere after it (e.g. a template that lost
 * its closing marker), everything from the opener to the end of the string
 * is redacted — a span that cannot be proven closed is treated as if its
 * content extends to the end, rather than trusted to end wherever the next
 * unrelated text happens to start.
 *
 * `rules` defaults to `TRACE_REDACTION_RULES`; a caller may pass its own
 * list to test composition (e.g. two rules whose spans nest) without
 * mutating the production rule set.
 */
export function redactSpans(
  text: string,
  rules: readonly TraceRedactionRule[] = TRACE_REDACTION_RULES,
): string {
  let result = text;
  for (const rule of rules) {
    result = redactRule(result, rule);
  }
  return result;
}

function redactRule(text: string, rule: TraceRedactionRule): string {
  let result = "";
  let cursor = 0;

  for (;;) {
    const openIdx = text.indexOf(rule.open, cursor);
    if (openIdx === -1) {
      result += text.slice(cursor);
      return result;
    }

    const contentStart = openIdx + rule.open.length;
    result += text.slice(cursor, contentStart);

    const closeIdx = text.indexOf(rule.close, contentStart);
    if (closeIdx === -1) {
      // Fail-closed: no closing marker anywhere after the opener — redact to
      // end-of-string rather than leave an ambiguous span unredacted.
      result += REDACTED;
      return result;
    }

    result += REDACTED;
    result += rule.close;
    cursor = closeIdx + rule.close.length;
  }
}

/**
 * `MaskFunction` for the Langfuse `CallbackHandler`'s `mask` option. Walks
 * strings inside `data` — a string, an array, or a plain object — applying
 * `redactSpans` to every string found. A non-string/array/object value
 * (number, boolean, null, undefined) passes through unchanged.
 *
 * Pure — no network, no side effects. The SDK itself wraps every call in a
 * try/catch and replaces the whole payload with a fixed string on a throw,
 * so this function does not need its own error handling to be fail-closed.
 */
export function redactTracedPayload(params: { data: unknown }): unknown {
  return redactValue(params.data);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSpans(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(entry);
    }
    return out;
  }
  return value;
}

/**
 * The fail-closed backstop check (17c PR3 — see design.md "The fail-closed
 * backstop"). The span rule alone fails OPEN: a rendering that lost its
 * `<body_profile>` delimiters would leave the body section's content
 * untagged, and `redactSpans` has nothing to match. This function is the
 * check run at the invoke seam, where the raw section text is still known,
 * to prove redaction actually WOULD have removed it.
 *
 * `innerText` must be the section's distinctive multi-line content (e.g.
 * "USER BODY PROFILE (self-reported):\n…"), never a bare numeral — a value
 * like "68" would false-positive against unrelated prompt text such as
 * "Session duration: 68 minutes".
 *
 * Returns `true` (verified) when `innerText` is empty (nothing to protect —
 * the byte-identical absent case) OR when redacting `renderedText` removes
 * every occurrence of `innerText`. Returns `false` when `innerText` survives
 * redaction — the signal to degrade rather than risk a leak.
 */
export function isRedactionVerified(renderedText: string, innerText: string): boolean {
  if (innerText.length === 0) {
    return true;
  }
  return !redactSpans(renderedText).includes(innerText);
}
