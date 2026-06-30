/**
 * Client-safe AI config constants and types.
 *
 * This module is intentionally free of `server-only` — it is imported by both
 * the server-side `ai-config-client.ts` (which IS server-only) and by the
 * client component `AiConfigForm.tsx`. Keeping pure constants here prevents
 * the build from failing when the client component tries to import constants
 * that would otherwise live behind a `server-only` guard.
 */

export const VALID_PROVIDERS = [
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "opencode-go",
] as const;

export type AiProvider = (typeof VALID_PROVIDERS)[number];

/**
 * Default model to pre-fill when the user switches providers.
 * Matches the design MODEL_DEFAULTS table.
 */
export const MODEL_DEFAULTS: Record<AiProvider, string> = {
  openrouter: "openai/gpt-4o-mini",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  google: "gemini-2.0-flash",
  "opencode-go": "deepseek-v4-flash",
};

export interface AiConfigRecord {
  provider: AiProvider;
  model: string;
  updatedAt: string;
}

export type GetConfigResult =
  | { kind: "ok"; config: AiConfigRecord | null }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export type UpdateConfigResult =
  | { kind: "ok"; config: AiConfigRecord }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };
