/**
 * Shared contract types for the kInorA monorepo.
 *
 * All workspace-internal types that cross app boundaries
 * MUST be defined here so both apps import from a single source of truth.
 */

export interface HealthResponse {
  status: "ok";
  timestamp: string; // ISO 8601
  uptime: number; // seconds since server start
}