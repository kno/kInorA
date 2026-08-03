import "server-only";

/**
 * Server-only API client for the gym Branding Studio (16a-v3-gym-white-label).
 *
 * Pure fetch + status→discriminated-result mapping, extracted from the
 * server/client components so it is unit-testable without Next.js framework
 * imports (mirrors `tenant-provisioning-client.ts`). Reads the INTERNAL
 * `API_BASE_URL` and must never be imported by a client component — the
 * client-safe types/helpers live in `branding-constants.ts`.
 *
 * Wires to the ALREADY-BUILT, gym-gated API surface (do NOT re-implement):
 *   - GET  /branding                    → own-tenant read (403 if not gym)
 *   - PUT  /branding                    → upsert (409 slug conflict, 400/422 invalid)
 *   - POST /branding/logo (multipart)   → logo upload (413/415 rejects)
 */

import type { BrandingPalette, TenantBrandingDTO } from "@kinora/contracts";

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? "http://localhost:4000";
}

type ClientOptions = { apiBaseUrl?: string; fetchImpl?: typeof fetch };

function authHeaders(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type FetchBrandingResult =
  | { kind: "ok"; branding: TenantBrandingDTO }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export type UpdateBrandingResult =
  | { kind: "ok"; branding: TenantBrandingDTO }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

export type UploadLogoResult =
  | { kind: "ok"; logoUrl: string }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "unsupported" }
  | { kind: "too_large" }
  | { kind: "error"; message: string };

/** GET /branding — own-tenant branding (gym-gated). */
export async function fetchBranding(
  token: string | undefined,
  options: ClientOptions = {},
): Promise<FetchBrandingResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/branding`, {
      headers: authHeaders(token),
      cache: "no-store",
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const branding = (await res.json()) as TenantBrandingDTO;
    return { kind: "ok", branding };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}

/** PUT /branding — upsert the own-tenant slug + palette (gym-gated). */
export async function updateBranding(
  token: string | undefined,
  input: { subdomainSlug: string; palette: BrandingPalette },
  options: ClientOptions = {},
): Promise<UpdateBrandingResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(`${base}/branding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(input),
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 409) return { kind: "conflict" };
    // The route rejects a malformed slug/palette with 400; 422 is the
    // documented invalid-palette code — treat both as a single "invalid".
    if (res.status === 400 || res.status === 422) return { kind: "invalid" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const branding = (await res.json()) as TenantBrandingDTO;
    return { kind: "ok", branding };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}

/** POST /branding/logo — multipart logo upload (gym-gated). */
export async function uploadLogo(
  token: string | undefined,
  file: File,
  options: ClientOptions = {},
): Promise<UploadLogoResult> {
  const base = options.apiBaseUrl ?? apiBaseUrl();
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const form = new FormData();
    form.append("file", file, file.name);

    const res = await fetchImpl(`${base}/branding/logo`, {
      method: "POST",
      headers: authHeaders(token),
      body: form,
    });

    if (res.status === 401) return { kind: "unauthorized" };
    if (res.status === 403) return { kind: "forbidden" };
    if (res.status === 413) return { kind: "too_large" };
    if (res.status === 415) return { kind: "unsupported" };
    if (res.status === 400) return { kind: "invalid" };
    if (!res.ok) return { kind: "error", message: `api_error_${res.status}` };

    const body = (await res.json()) as { logoUrl: string };
    return { kind: "ok", logoUrl: body.logoUrl };
  } catch {
    return { kind: "error", message: "api_unreachable" };
  }
}
