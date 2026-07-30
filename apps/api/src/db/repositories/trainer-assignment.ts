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
export class TrainerAssignmentRepository {
  constructor(private db: Database) {}

  /**
   * Create a new assignment row. Defaults to `status: "invited"` — the
   * invite flow (Slice 3) transitions it to `active` on acceptance.
   * The data layer enforces one-active-trainer-per-client via the partial
   * unique index `trainer_client_assignments_client_active_unique`; a second
   * concurrent active assignment for the same client raises a unique
   * violation the caller must surface (409 in Slice 3), never silently
   * overwritten here.
   */
  async create(
    tenantId: string,
    trainerUserId: string,
    clientUserId: string,
    status: TrainerAssignmentStatus = "invited",
  ): Promise<TrainerClientAssignmentDTO> {
    const rows = await this.db
      .insert(trainerClientAssignments)
      .values({ tenantId, trainerUserId, clientUserId, status })
      .returning();
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
