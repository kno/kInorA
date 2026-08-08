import { renderTemplate, type PromptDefinition } from "./prompt-template.js";
import { PromptNotFoundError, type LangfusePromptGateway, type PromptResolution } from "./prompt-source-port.js";
import {
  validateRemoteTemplate,
  checkRenderedTemplate,
  missingRemoteVariables,
  type PromptRejectionReason,
} from "./remote-template-validation.js";
import type { ObservabilityLogger } from "../observability/event-logger.js";

/**
 * Resolves each of the three in-scope prompt templates from Langfuse under
 * the fixed `production` label, with the compiled-in local template as
 * mandatory fallback (langfuse-prompt-management, slice B2).
 *
 * Mirrors `ResolveBillingPricing` (`billing/billing-pricing.ts:69-136`):
 * injectable `cacheTtlMs` + `now`, a `pending` promise coalescing a
 * cold-cache burst into ONE upstream call PER PROMPT NAME, and fallback on
 * ANY failure class through an injectable secret-free `warn` sink. The
 * fallback result is cached too, so a sustained Langfuse outage does not
 * cause an upstream call on every request.
 */

const DEFAULT_CACHE_TTL_MS = 60_000;
const PRODUCTION_LABEL = "production";

interface CacheEntry {
  resolution: PromptResolution;
  expiresAt: number;
}

export interface ResolvePromptOptions {
  /** In-process cache TTL in ms, keyed per prompt name (defaults to 60s). */
  cacheTtlMs?: number;
  /** Monotonic-ish clock in ms (defaults to `Date.now`) — injectable for tests. */
  now?: () => number;
  /**
   * Secret-free warn sink for a fallback resolution. Carries a reason code,
   * the prompt name, and (for gateway failures) the error's `name` only —
   * never the template body, never a credential.
   */
  warn?: (reason: PromptRejectionReason, promptName: string, errorName?: string) => void;
  /**
   * Observability seam for the template-drift signal (#390). Optional: when
   * absent, drift is simply not reported — resolution behaviour is identical
   * either way.
   */
  observability?: ObservabilityLogger;
}

/** Event name for the remote-template drift signal (#390). */
export const PROMPT_TEMPLATE_DRIFT_EVENT = "prompt.template_drift";

export class ResolvePrompt {
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly warn: (reason: PromptRejectionReason, promptName: string, errorName?: string) => void;
  private readonly observability?: ObservabilityLogger;
  private readonly cache = new Map<string, CacheEntry>();
  /**
   * One in-flight resolution PER PROMPT NAME, coalescing a cold-cache burst
   * into a single upstream call — the same pattern as
   * `ResolveBillingPricing.pending`, keyed here because three prompt names
   * share one provider instance.
   */
  private readonly pending = new Map<string, Promise<PromptResolution>>();

  constructor(
    private readonly gateway: LangfusePromptGateway | null,
    options: ResolvePromptOptions = {}
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.warn =
      options.warn ??
      ((reason, promptName) => console.warn(`[prompt-provider] ${promptName}: ${reason}`));
    this.observability = options.observability;
  }

  async execute(def: PromptDefinition, variables: Record<string, string>): Promise<PromptResolution> {
    const cached = this.cache.get(def.name);
    if (cached && this.now() < cached.expiresAt) {
      return cached.resolution;
    }

    const inFlight = this.pending.get(def.name);
    if (inFlight) {
      return inFlight;
    }

    const resolution = this.resolve(def, variables)
      .then((resolution) => {
        // Cache whatever was resolved — remote OR fallback — so a sustained
        // outage does not hammer Langfuse on every request; the next request
        // after the TTL retries live sourcing.
        this.cache.set(def.name, { resolution, expiresAt: this.now() + this.cacheTtlMs });
        return resolution;
      })
      .finally(() => {
        this.pending.delete(def.name);
      });
    this.pending.set(def.name, resolution);
    return resolution;
  }

  private async resolve(
    def: PromptDefinition,
    variables: Record<string, string>
  ): Promise<PromptResolution> {
    if (!this.gateway) {
      return this.fallback(def, variables, "no_credentials");
    }

    let fetched: { template: unknown; version: number };
    try {
      fetched = await this.gateway.fetchPrompt(def.name, PRODUCTION_LABEL);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const reason: PromptRejectionReason =
        error instanceof PromptNotFoundError ? "prompt_not_found" : "fetch_failed";
      return this.fallback(def, variables, reason, errorName);
    }

    const validated = validateRemoteTemplate(def, fetched.template);
    if (!validated.ok) {
      return this.fallback(def, variables, validated.reason);
    }

    const rendered = renderTemplate(validated.template, variables).trim();
    const renderCheck = checkRenderedTemplate(rendered);
    if (!renderCheck.ok) {
      return this.fallback(def, variables, renderCheck.reason);
    }

    this.reportDrift(def, validated.template, fetched.version);
    return { text: rendered, source: "langfuse", name: def.name, version: fetched.version };
  }

  /**
   * Reports — never blocks — a remote template that omits variables the
   * repository definition declares (#390). The remote template has already
   * passed validation and IS served; this only makes the gap visible, so a
   * merged repository change that never reached the Langfuse-hosted prompt
   * stops being invisible.
   *
   * PII invariant (`observability/event-logger.ts`): the metadata carries the
   * prompt name and the missing VARIABLE NAMES only — never template text,
   * never rendered output, never a variable's value.
   */
  private reportDrift(def: PromptDefinition, template: string, version: number): void {
    const missing = missingRemoteVariables(def, template);
    if (missing.length === 0) return;
    this.observability?.recordEvent({
      level: "warn",
      event: PROMPT_TEMPLATE_DRIFT_EVENT,
      outcome: "remote_missing_variables",
      metadata: {
        promptName: def.name,
        promptVersion: version,
        missingVariables: missing.join(","),
        missingVariableCount: missing.length,
      },
    });
  }

  private fallback(
    def: PromptDefinition,
    variables: Record<string, string>,
    reason: PromptRejectionReason,
    errorName?: string
  ): PromptResolution {
    this.warn(reason, def.name, errorName);
    return { text: renderTemplate(def.localTemplate, variables).trim(), source: "fallback" };
  }
}

/**
 * Reads the prompt cache TTL from `LANGFUSE_PROMPT_CACHE_TTL_MS` (milliseconds),
 * defaulting to 60000 ms when unset. An unparseable or non-positive value
 * falls back to the default rather than throwing at startup.
 */
export function resolvePromptCacheTtlMs(env: Record<string, string | undefined>): number {
  const raw = env["LANGFUSE_PROMPT_CACHE_TTL_MS"];
  if (!raw) return DEFAULT_CACHE_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}
