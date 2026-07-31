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
