import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ClientSummaryDTO, InviteClientRequest, TrainerClientAssignmentDTO } from "@kinora/contracts";
import { requireRole, requireAuth } from "../auth/plugin.js";
import { assertTrainerEntitled, ForbiddenOwnerAccess } from "../trainer/owner-access.js";
import type { ActorOwnerContext } from "../trainer/owner-access.js";
import type { EntitlementReaderPort } from "../billing/entitlement.js";

/**
 * Trainer invite/assignment/list-clients routes (15a-v2-trainer-account-
 * access, Slice 3).
 *
 * `POST /trainer/clients/invite` and `GET /trainer/clients` are gated by BOTH
 * `requireRole("trainer")` (role-only, see auth/plugin.ts) AND
 * `assertTrainerEntitled` (role+tier, the SAME gate `resolveAuthorizedOwner`
 * uses — see trainer/owner-access.ts). Neither route resolves ownership over
 * an EXISTING client's data via `resolveAuthorizedOwner` itself: invite has no
 * prior assignment to resolve, and list is scoped to the caller's own
 * assignments (`listByTrainer(tenantId, actorUserId)`), never a requested
 * owner id.
 *
 * `POST /trainer/clients/accept` is the client-side half of the invite flow —
 * gated by `requireAuth()` only (the client is never a trainer for this
 * action); it transitions the caller's own pending invite regardless of which
 * tenant their CURRENT session happens to be scoped to (see
 * `TrainerAssignmentRepository.findByClientUserId`'s doc comment for why that
 * lookup is deliberately not tenant-scoped).
 */
/**
 * Local structural port for the trainer/client assignment repository —
 * declares only the methods this route calls, so the route never imports
 * from `db/repositories` (architecture rule `routes-no-db-layer`). The
 * concrete `TrainerAssignmentRepository` (wired in app.ts) satisfies this
 * structurally.
 */
interface TrainerRouteAssignmentRepo {
  create(
    tenantId: string,
    trainerUserId: string,
    clientUserId: string,
    status?: TrainerClientAssignmentDTO["status"],
  ): Promise<TrainerClientAssignmentDTO>;
  findByClientUserId(clientUserId: string): Promise<TrainerClientAssignmentDTO | undefined>;
  updateStatus(
    tenantId: string,
    id: string,
    status: TrainerClientAssignmentDTO["status"],
  ): Promise<number>;
  listByTrainer(tenantId: string, trainerUserId: string): Promise<TrainerClientAssignmentDTO[]>;
}

/**
 * Local structural port for the membership repository (see
 * `TrainerRouteAssignmentRepo` doc comment for why this is local, not
 * imported).
 */
interface TrainerRouteMembershipRepo {
  upsertInvited(
    tenantId: string,
    userId: string,
    role: "owner" | "member" | "trainer",
  ): Promise<unknown>;
  updateStatusByTenantAndUser(
    tenantId: string,
    userId: string,
    status: "invited" | "active" | "suspended",
  ): Promise<number>;
}

/** Minimal user record shape the route reads (see doc comment above). */
interface TrainerRouteUser {
  id: string;
  email: string;
}

/**
 * Local structural port for the user repository (see
 * `TrainerRouteAssignmentRepo` doc comment for why this is local, not
 * imported).
 */
interface TrainerRouteUserRepo {
  findByEmail(email: string): Promise<TrainerRouteUser | null>;
  findById(id: string): Promise<TrainerRouteUser | null>;
}

export interface TrainerRoutesOptions {
  assignmentRepo: TrainerRouteAssignmentRepo;
  membershipRepo: TrainerRouteMembershipRepo;
  userRepo: TrainerRouteUserRepo;
  entitlementReader: Pick<EntitlementReaderPort, "loadContext">;
}

const inviteSchema = {
  body: {
    type: "object",
    required: ["email"],
    properties: {
      email: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
};

function toActorOwnerContext(request: FastifyRequest): ActorOwnerContext {
  const { tenantId, userId, role } = request.authContext!;
  return { tenantId, actorUserId: userId, role };
}

export const trainerRoutes: FastifyPluginAsync<TrainerRoutesOptions> = async (fastify, options) => {
  const { assignmentRepo, membershipRepo, userRepo, entitlementReader } = options;

  // POST /trainer/clients/invite
  fastify.post(
    "/trainer/clients/invite",
    { schema: inviteSchema, preHandler: requireRole("trainer") },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = toActorOwnerContext(request);
      const body = request.body as InviteClientRequest;

      try {
        await assertTrainerEntitled(ctx, { entitlementReader });
      } catch (err) {
        if (err instanceof ForbiddenOwnerAccess) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      const client = await userRepo.findByEmail(body.email);
      if (!client) {
        return reply.code(404).send({ error: "client_not_found" });
      }

      // Pre-check for the common (non-racing) case — surfaces a clean 409
      // without touching the membership table at all. The partial unique
      // index on `trainer_client_assignments` remains the authoritative,
      // race-safe enforcement (caught below as a defence-in-depth fallback).
      const existing = await assignmentRepo.findByClientUserId(client.id);
      if (existing && existing.status !== "revoked") {
        return reply.code(409).send({ error: "client_already_assigned" });
      }

      await membershipRepo.upsertInvited(ctx.tenantId, client.id, "member");

      let assignment: TrainerClientAssignmentDTO;
      try {
        assignment = await assignmentRepo.create(ctx.tenantId, ctx.actorUserId, client.id, "invited");
      } catch (err) {
        // Structural check (by name, not `instanceof`) so this route never
        // imports `TrainerAssignmentConflictError` from `db/repositories`
        // (architecture rule `routes-no-db-layer`). The repository's error
        // class sets `this.name = "TrainerAssignmentConflictError"` in its
        // constructor, so this is a reliable, import-free detection.
        if (err instanceof Error && err.name === "TrainerAssignmentConflictError") {
          return reply.code(409).send({ error: "client_already_assigned" });
        }
        throw err;
      }

      return reply.code(201).send(assignment);
    },
  );

  // POST /trainer/clients/accept
  fastify.post(
    "/trainer/clients/accept",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;

      const assignment = await assignmentRepo.findByClientUserId(userId);
      if (!assignment || assignment.status !== "invited") {
        return reply.code(404).send({ error: "no_pending_invite" });
      }

      await assignmentRepo.updateStatus(assignment.tenantId, assignment.id, "active");
      await membershipRepo.updateStatusByTenantAndUser(assignment.tenantId, userId, "active");

      return reply.code(200).send({ ...assignment, status: "active" });
    },
  );

  // GET /trainer/clients
  fastify.get(
    "/trainer/clients",
    { preHandler: requireRole("trainer") },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = toActorOwnerContext(request);

      try {
        await assertTrainerEntitled(ctx, { entitlementReader });
      } catch (err) {
        if (err instanceof ForbiddenOwnerAccess) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      const assignments = await assignmentRepo.listByTrainer(ctx.tenantId, ctx.actorUserId);
      const clients: ClientSummaryDTO[] = [];
      for (const assignment of assignments) {
        const user = await userRepo.findById(assignment.clientUserId);
        clients.push({
          clientUserId: assignment.clientUserId,
          email: user?.email ?? "",
          status: assignment.status,
        });
      }

      return reply.code(200).send(clients);
    },
  );
};
