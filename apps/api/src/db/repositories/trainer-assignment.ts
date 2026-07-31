import { and, eq } from "drizzle-orm";
import { trainerClientAssignments } from "../schema.js";
import type { Database } from "../client.js";
import type { TrainerAssignmentStatus, TrainerClientAssignmentDTO } from "@kinora/contracts";

/**
 * Trainer/client assignment persistence repository (15a-v2-trainer-account-
 * access, Slice 1). Dark/additive: no route calls this yet — the authorization
 * seam that reads `findActiveAssignment` lands in Slice 2, and the invite/list
 * routes that call `create`/`listByTrainer` land in Slice 3.
 *
 * Tenant-scoped like every other repository in this codebase: every read
 * filters by `tenantId` in addition to the trainer/client ids, so a row from
 * another tenant is never returned even if the caller supplies a matching
 * trainer/client user id pair.
 */
/**
 * Thrown by `TrainerAssignmentRepository.create` when the insert violates the
 * one-active-trainer-per-client partial unique index (15a-v2-trainer-account-
 * access, Slice 3, task 3.4). Translates the raw Postgres unique-violation
 * (error code `23505`) into a typed, DB-agnostic error so route code never
 * needs to know a Postgres error code — it maps this to 409.
 */
export class TrainerAssignmentConflictError extends Error {
  constructor(message = "trainer_assignment_conflict") {
    super(message);
    this.name = "TrainerAssignmentConflictError";
  }
}

/** True when `err` looks like a Postgres unique-violation error (code 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

export class TrainerAssignmentRepository {
  constructor(private db: Database) {}

  /**
   * Create a new assignment row. Defaults to `status: "invited"` — the
   * invite flow (Slice 3) transitions it to `active` on acceptance.
   * The data layer enforces one-active-trainer-per-client via the partial
   * unique index `trainer_client_assignments_client_active_unique`; a second
   * concurrent active assignment for the same client raises a unique
   * violation, translated here into `TrainerAssignmentConflictError` (the
   * route layer maps it to 409 without inspecting Postgres error codes).
   */
  async create(
    tenantId: string,
    trainerUserId: string,
    clientUserId: string,
    status: TrainerAssignmentStatus = "invited",
  ): Promise<TrainerClientAssignmentDTO> {
    let rows: unknown[];
    try {
      rows = await this.db
        .insert(trainerClientAssignments)
        .values({ tenantId, trainerUserId, clientUserId, status })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new TrainerAssignmentConflictError();
      }
      throw err;
    }
    const row = rows[0] as {
      id: string;
      tenantId: string;
      trainerUserId: string;
      clientUserId: string;
      status: TrainerAssignmentStatus;
    };
    return {
      id: row.id,
      tenantId: row.tenantId as TrainerClientAssignmentDTO["tenantId"],
      trainerUserId: row.trainerUserId as TrainerClientAssignmentDTO["trainerUserId"],
      clientUserId: row.clientUserId as TrainerClientAssignmentDTO["clientUserId"],
      status: row.status,
    };
  }

  /**
   * Find the client's single non-revoked assignment, regardless of tenant
   * (15a-v2-trainer-account-access, Slice 3 — invite acceptance). Deliberately
   * NOT tenant-scoped: unlike every other read in this repository, the caller
   * (the client accepting an invite) is not yet a member of the trainer's
   * tenant, so there is no request-scoped tenantId to filter by. This is safe
   * ONLY because the partial unique index
   * (`trainer_client_assignments_client_active_unique`, `WHERE status <>
   * 'revoked'`) guarantees at most one non-revoked row per client across the
   * WHOLE table — there is no ambiguity to resolve.
   */
  async findByClientUserId(
    clientUserId: string,
  ): Promise<TrainerClientAssignmentDTO | undefined> {
    const rows = await this.db
      .select()
      .from(trainerClientAssignments)
      .where(eq(trainerClientAssignments.clientUserId, clientUserId));
    const row = rows.find(
      (r) => (r as { status: TrainerAssignmentStatus }).status !== "revoked",
    ) as
      | {
          id: string;
          tenantId: string;
          trainerUserId: string;
          clientUserId: string;
          status: TrainerAssignmentStatus;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      tenantId: row.tenantId as TrainerClientAssignmentDTO["tenantId"],
      trainerUserId: row.trainerUserId as TrainerClientAssignmentDTO["trainerUserId"],
      clientUserId: row.clientUserId as TrainerClientAssignmentDTO["clientUserId"],
      status: row.status,
    };
  }

  /**
   * The authorization-critical read (consumed by `resolveAuthorizedOwner` in
   * Slice 2): returns the assignment ONLY when it is `active` for this exact
   * `(tenantId, trainerUserId, clientUserId)` triple. Returns `undefined` for
   * a missing, revoked, or merely-invited assignment — the resolver treats
   * all of those identically (deny).
   */
  async findActiveAssignment(
    tenantId: string,
    trainerUserId: string,
    clientUserId: string,
  ): Promise<TrainerClientAssignmentDTO | undefined> {
    const rows = await this.db
      .select()
      .from(trainerClientAssignments)
      .where(
        and(
          eq(trainerClientAssignments.tenantId, tenantId),
          eq(trainerClientAssignments.trainerUserId, trainerUserId),
          eq(trainerClientAssignments.clientUserId, clientUserId),
          eq(trainerClientAssignments.status, "active"),
        ),
      );
    const row = rows[0] as
      | {
          id: string;
          tenantId: string;
          trainerUserId: string;
          clientUserId: string;
          status: TrainerAssignmentStatus;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      tenantId: row.tenantId as TrainerClientAssignmentDTO["tenantId"],
      trainerUserId: row.trainerUserId as TrainerClientAssignmentDTO["trainerUserId"],
      clientUserId: row.clientUserId as TrainerClientAssignmentDTO["clientUserId"],
      status: row.status,
    };
  }

  /**
   * List every assignment for a given trainer within the trainer's tenant
   * (any status). The Slice 3 `GET /trainer/clients` route filters/maps this
   * to `ClientSummaryDTO[]`; this repository stays a plain tenant-scoped read.
   */
  async listByTrainer(
    tenantId: string,
    trainerUserId: string,
  ): Promise<TrainerClientAssignmentDTO[]> {
    const rows = await this.db
      .select()
      .from(trainerClientAssignments)
      .where(
        and(
          eq(trainerClientAssignments.tenantId, tenantId),
          eq(trainerClientAssignments.trainerUserId, trainerUserId),
        ),
      );
    return (
      rows as Array<{
        id: string;
        tenantId: string;
        trainerUserId: string;
        clientUserId: string;
        status: TrainerAssignmentStatus;
      }>
    ).map((row) => ({
      id: row.id,
      tenantId: row.tenantId as TrainerClientAssignmentDTO["tenantId"],
      trainerUserId: row.trainerUserId as TrainerClientAssignmentDTO["trainerUserId"],
      clientUserId: row.clientUserId as TrainerClientAssignmentDTO["clientUserId"],
      status: row.status,
    }));
  }

  /**
   * Transition an assignment's status, scoped to `(tenantId, id)` so a
   * cross-tenant id never updates another tenant's row. Used by the Slice 3
   * accept/revoke flows. Returns the number of rows updated (0 = not found
   * for this tenant, matching the 404-without-a-separate-read pattern used
   * elsewhere in this codebase, e.g. `PlanSpecRepository.updateSpecDaysPerWeek`).
   */
  async updateStatus(
    tenantId: string,
    id: string,
    status: TrainerAssignmentStatus,
  ): Promise<number> {
    const rows = await this.db
      .update(trainerClientAssignments)
      .set({ status })
      .where(and(eq(trainerClientAssignments.tenantId, tenantId), eq(trainerClientAssignments.id, id)))
      .returning();
    return rows.length;
  }
}
