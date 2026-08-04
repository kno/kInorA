/**
 * Client-safe result/input types for the trainer client-list surface
 * (15a-v2-trainer-account-access, Slice 5).
 *
 * Deliberately split out of `trainer-client.ts` (which is `server-only`):
 * these types carry no server-only logic and must be importable from
 * `"use client"` components. `trainer-client.ts` and `actions.ts` re-export
 * (or import) from here so there is a single source of truth.
 */
import type { ClientSummaryDTO } from "@kinora/contracts";
import type { PlanGoal, PlanLimitation, TrainingLocation } from "@kinora/contracts";

export type FetchClientsResult =
  | { kind: "ok"; clients: ClientSummaryDTO[] }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export type InviteClientResult =
  | { kind: "ok" }
  | { kind: "error"; message: string };

/** Minimal wizard-shaped input the trainer supplies directly (no draft phase — see plan.ts). */
export interface CreatePlanForClientInput {
  goal: PlanGoal;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  location: TrainingLocation;
  equipment: string[];
  limitations: PlanLimitation[];
}

export type CreatePlanForClientResult =
  | { kind: "ok"; planId: string; status: string }
  | { kind: "error"; message: string };

/**
 * A client-owned plan as read by an assigned trainer (#341). Same client DTO
 * `GET /workout-plans/:id` returns — the API never exposes the raw row.
 */
export interface ClientPlanDetail {
  id: string;
  status: string;
  program?: unknown;
  specId?: string;
  /** Resolved plan label (#93) — the API applies the blank→default rule. */
  name?: string;
}

/**
 * `forbidden` and `notFound` are DISTINCT so the trainer-facing view can tell
 * "you are not this client's trainer" from "no such plan for this client",
 * without either state leaking the other's existence: the API already answers
 * 403 before any read on a denial, so `notFound` is only ever reached by an
 * authorized caller.
 */
export type FetchClientPlanResult =
  | { kind: "ok"; plan: ClientPlanDetail }
  | { kind: "forbidden" }
  | { kind: "notFound" }
  | { kind: "error"; message: string };
