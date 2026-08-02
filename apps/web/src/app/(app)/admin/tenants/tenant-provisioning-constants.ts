/**
 * Client-safe tenant-provisioning constants and result types (GH #307).
 *
 * Intentionally free of `server-only`: imported by both the server-only
 * `tenant-provisioning-client.ts` and the client component
 * `TenantProvisioningForm.tsx`. Keeping the pure types/enums here prevents the
 * build from failing when the client component imports them.
 */

/** The two grantable override tiers (mirrors the API `z.enum(["trainer","gym"])`). */
export const GRANTABLE_TIERS = ["trainer", "gym"] as const;
export type GrantableTier = (typeof GRANTABLE_TIERS)[number];

export interface TenantSummary {
  id: string;
  name: string;
}

export interface ActiveOverrideSummary {
  id: string;
  tier: GrantableTier;
  startsAt: string;
  endsAt: string;
}

export interface TenantOverrideStatus {
  tenant: TenantSummary;
  effectiveTier: string;
  billingStatus: string | null;
  activeOverride: ActiveOverrideSummary | null;
}

export interface GrantOverrideRequest {
  tier: GrantableTier;
  reason: string;
  startsAt?: string;
  endsAt?: string;
  /**
   * Optional idempotency key (#313). The form generates a fresh UUID per grant
   * submit and reuses it across a retried submit, so a retry after a network
   * timeout carries the same key and the API replays the original 201 instead
   * of a spurious 409 conflict.
   */
  operationKey?: string;
}

/**
 * Discriminated result envelope shared by every server-only call and the
 * client form — mirrors `ai-config-client.ts`'s `kind` union so the form maps
 * each API status to a single human message.
 */
export type SearchTenantsResult =
  | { kind: "ok"; tenants: TenantSummary[] }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

export type FetchStatusResult =
  | { kind: "ok"; status: TenantOverrideStatus }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export type GrantResult =
  | { kind: "ok" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "invalid" }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

export type RevokeResult =
  | { kind: "ok" }
  | { kind: "unauthorized" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };
