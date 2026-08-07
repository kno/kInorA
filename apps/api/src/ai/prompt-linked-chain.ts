import { Runnable, RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

/**
 * Native prompt-version linkage (langfuse-prompt-management, slice C).
 *
 * Langfuse's `CallbackHandler.registerLangfusePrompt` only records a prompt
 * when `handleChainStart` fires with a truthy `parentRunId`, and the
 * generation lookup happens under the MODEL run's own `parentRunId`
 * (`design.md`'s "Installed SDK Verification"). `withStructuredOutput(schema)`
 * (no `includeRaw`) returns `llm.pipe(outputParser)` — a `RunnableSequence`
 * whose FIRST step is the model — so the model has no parent to register
 * under, and a bare streaming model has no parent at all. Piping a step in
 * front does not fix it either: neither `Runnable.pipe` nor
 * `RunnableSequence.from` flattens a nested sequence.
 *
 * The fix is to rebuild ONE FLAT sequence whose first step is our own prompt
 * step, reusing the structured chain's exact `steps` so the model becomes a
 * sibling of the prompt step under the same run. That satisfies the SDK's
 * `parentRunId` precondition exactly.
 */
export interface PromptLinkedChain<T> {
  chain: T;
  linked: boolean;
}

/**
 * Identity over the already-rendered, already-MASKED prompt string. Never a
 * `ChatPromptTemplate` — LangChain templating would reinterpret the JSON
 * braces in the output-format block, the same reason the `{{variable}}`
 * renderer was chosen over it (`prompt-template.ts`). Masking is therefore
 * unaffected: `mask()` already ran on the rendered string before this value
 * is handed to `.invoke`/`.stream`, so this step and everything downstream of
 * it only ever observe masked text.
 */
export function promptStep(): Runnable<string, string> {
  return RunnableLambda.from((prompt: string) => prompt);
}

/**
 * Reparents a structured-output chain — `llm.withStructuredOutput(schema)`,
 * shaped as `RunnableSequence.from([boundLlm, parser])` — into one flat
 * sequence `RunnableSequence.from([promptStep(), ...structured.steps])`, so
 * the model run registers as a sibling of the prompt step.
 *
 * Per-call shape guard, not a per-build assumption: all five plan-generation
 * providers share this path, and a provider (or a future `@langchain/*` bump)
 * may hand back a differently shaped chain — notably `includeRaw: true`
 * yields a `RunnableMap`-first sequence, which this guard also declines,
 * since blindly reparenting it would not put the prompt step next to the
 * actual model run. The `null`/`undefined` check MUST precede
 * `RunnableSequence.isRunnableSequence`, since that static dereferences
 * `thing.middle`. A non-matching shape degrades to the original runnable,
 * UNTOUCHED — this function never throws.
 */
export function linkStructuredChain<
  T extends { invoke: (input: string, options: Record<string, unknown>) => Promise<unknown> },
>(structured: T): PromptLinkedChain<T | Runnable<string, unknown>> {
  if (structured == null || !RunnableSequence.isRunnableSequence(structured)) {
    return { chain: structured, linked: false };
  }
  // `RunnableSequence.from`'s tuple signature ([first, ...middle, last])
  // requires a statically-known last element, which a runtime-length spread
  // of `structured.steps` can never provide — cast to the shape its own
  // implementation actually accepts (`_coerceToRunnable` over each element).
  const steps = [promptStep(), ...structured.steps] as unknown as Parameters<typeof RunnableSequence.from>[0];
  const chain = RunnableSequence.from(steps);
  return { chain, linked: true };
}

/**
 * Wraps a bare streaming chat model as a flat `[promptStep, model]` sequence,
 * mirroring `linkStructuredChain`'s guard. `Runnable.isRunnable` is the
 * duck-typed, cross-realm-safe check (`thing.lc_runnable`), unlike
 * `instanceof`. A non-matching shape degrades to the original model,
 * UNTOUCHED — this function never throws.
 */
export function linkStreamingModel<
  T extends { stream: (input: string, options?: Record<string, unknown>) => Promise<unknown> },
>(model: T): PromptLinkedChain<T | Runnable<string, unknown>> {
  if (model == null || !Runnable.isRunnable(model)) {
    return { chain: model, linked: false };
  }
  const chain = RunnableSequence.from([promptStep(), model]);
  return { chain, linked: true };
}
