/**
 * Pure API client for the AI provider admin config endpoints.
 *
 * Extracted from the server/client components so the API-call + result-mapping
 * logic is unit-testable without Next.js framework imports.
 * Mirrors the plan-draft-client.ts pattern.
 *
 * API keys are NEVER sent or received — only provider + model.
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

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

/**
 * Fetch the current AI provider config from GET /admin/ai-config.
 * Returns forbidden when the API responds 403.
 * Returns null config when the API responds null (no DB row yet).
 */
export async function fetchAiConfig(
  token: string | undefined,
  options: { apiBaseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<GetConfigResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/admin/ai-config`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const body = (await res.json()) as AiConfigRecord | null;
    return { kind: "ok", config: body };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}

/**
 * Update the active AI provider config via PUT /admin/ai-config.
 * Returns forbidden when the API responds 403.
 * Returns invalid when the API responds 422 (unknown provider / empty model).
 */
export async function updateAiConfig(
  token: string | undefined,
  provider: AiProvider,
  model: string,
  options: { apiBaseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<UpdateConfigResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/admin/ai-config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ provider, model }),
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 422) return { kind: "invalid", message: "invalid_payload" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const body = (await res.json()) as AiConfigRecord;
    return { kind: "ok", config: body };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}
