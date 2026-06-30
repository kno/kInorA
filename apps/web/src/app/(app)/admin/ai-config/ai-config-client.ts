import "server-only";

/**
 * Pure API client for the AI provider admin config endpoints.
 *
 * Extracted from the server/client components so the API-call + result-mapping
 * logic is unit-testable without Next.js framework imports.
 * Mirrors the plan-draft-client.ts pattern.
 *
 * API keys are NEVER sent or received — only provider + model.
 *
 * This module is server-only: it reads process.env.API_BASE_URL (the internal
 * Docker address) and must never be imported by client components.
 * Client-safe constants (VALID_PROVIDERS, MODEL_DEFAULTS, AiProvider, types)
 * are defined in ai-config-constants.ts and re-exported here for server
 * importers that already depend on this module.
 */

import {
  VALID_PROVIDERS,
  MODEL_DEFAULTS,
  type AiProvider,
  type AiConfigRecord,
  type GetConfigResult,
  type UpdateConfigResult,
} from "./ai-config-constants";

export {
  VALID_PROVIDERS,
  MODEL_DEFAULTS,
  type AiProvider,
  type AiConfigRecord,
  type GetConfigResult,
  type UpdateConfigResult,
};

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
