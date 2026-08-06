/**
 * Narrow port over a remote prompt source (langfuse-prompt-management, slice
 * B2). `ResolvePrompt` (`prompt-provider.ts`) depends only on this interface,
 * never on the Langfuse SDK directly — mirrors `ResolveBillingPricing`'s
 * `PriceGateway` port (`billing/stripe-gateway.ts`).
 */
export interface LangfusePromptGateway {
  /**
   * Fetches a prompt by name under the given label. `template` is `unknown`
   * because the fetched payload is UNTRUSTED third-party input — it must
   * pass `validateRemoteTemplate` (`remote-template-validation.ts`) before
   * use. Rejects (throws) on every failure class: network, authentication,
   * or a missing prompt (as a {@link PromptNotFoundError}). The caller
   * (`ResolvePrompt`) is responsible for catching every failure class and
   * falling back to the local template.
   */
  fetchPrompt(name: string, label: string): Promise<{ template: unknown; version: number }>;
}

/** Resolved prompt text + attribution, returned by `ResolvePrompt.execute`. */
export interface PromptResolution {
  /** Rendered text — NOT masked. Callers mask the RENDERED string themselves. */
  text: string;
  source: "langfuse" | "fallback";
  /** Present only when `source === "langfuse"`. */
  name?: string;
  /** Present only when `source === "langfuse"`. */
  version?: number;
}

/**
 * Thrown by a {@link LangfusePromptGateway} implementation when no prompt is
 * registered under the requested name/label — distinguished from a generic
 * transport/auth failure so `ResolvePrompt` can assign the more specific
 * `prompt_not_found` reason code instead of the catch-all `fetch_failed`.
 */
export class PromptNotFoundError extends Error {
  constructor(name: string) {
    super(`Langfuse prompt not found: ${name}`);
    this.name = "PromptNotFoundError";
  }
}
