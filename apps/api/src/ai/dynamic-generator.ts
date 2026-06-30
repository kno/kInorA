import type { PlanSpec, WorkoutProgram } from "@kinora/contracts";
import type { PlanGenerator } from "./port.js";

/**
 * Minimal shape of the AI provider config repository needed by DynamicPlanGenerator.
 */
export interface DynamicConfigRepo {
  getActive(): Promise<{ provider: string; model: string } | null>;
}

/**
 * Adapter factory map: maps provider name to a factory that accepts the model
 * string and returns a PlanGenerator instance.
 *
 * This pattern keeps DynamicPlanGenerator decoupled from concrete adapter
 * implementations — adapters are injected, not imported directly.
 *
 * In production, built by `buildAdapters()` in `adapter-factory.ts`.
 * In tests, mocked per-provider as needed.
 */
export type AdapterFactoryMap = Record<string, (model: string) => PlanGenerator>;

/**
 * DynamicPlanGenerator — reads the active AI provider config from DB on EVERY
 * `generate()` call, then delegates to the correct provider adapter.
 *
 * Key behaviors:
 * - Per-request config read: config changes take effect on the NEXT generation.
 *   There is no mid-request hot-swap — the config is read once per call.
 * - Fallback: when no DB row exists, falls back to the "openrouter" adapter
 *   (retrocompatible with the current OPENROUTER_API_KEY env var behavior).
 * - Adapter isolation: each provider adapter is constructed fresh per call via
 *   its factory. This is intentional — adapters hold no mutable state.
 *
 * Implements the `PlanGenerator` port.
 */
export class DynamicPlanGenerator implements PlanGenerator {
  constructor(
    private readonly configRepo: DynamicConfigRepo,
    private readonly adapters: AdapterFactoryMap
  ) {}

  async generate(spec: PlanSpec): Promise<WorkoutProgram> {
    // Read config from DB on every call — NOT cached.
    const config = await this.configRepo.getActive();

    // Determine provider and model: use DB config or fall back to openrouter.
    const provider = config?.provider ?? "openrouter";
    const model = config?.model ?? (process.env["OPENROUTER_MODEL"] ?? "openai/gpt-4o-mini");

    const factory = this.adapters[provider];
    if (!factory) {
      throw new Error(`[DynamicPlanGenerator] No adapter registered for provider: "${provider}"`);
    }

    const adapter = factory(model);
    return adapter.generate(spec);
  }
}
