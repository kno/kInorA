import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type {
  ClientDashboardDTO,
  ClientSummaryDTO,
  ExerciseDetailDTO,
  InviteClientRequest,
  PlanBranding,
  StatsSummaryDTO,
  TrainerClientAssignmentDTO,
  UserId,
  WeeklyOverviewDTO,
} from "@kinora/contracts";
import { requireRole, requireAuth } from "../auth/plugin.js";
import { assertTrainerEntitled, resolveAuthorizedOwner, ForbiddenOwnerAccess } from "../trainer/owner-access.js";
import type { ObservabilityLogger } from "../observability/event-logger.js";
import type { ActorOwnerContext } from "../trainer/owner-access.js";
import { resolveClientTrainerTenant } from "../trainer/client-access.js";
import type { EntitlementReaderPort } from "../billing/entitlement.js";
import { parseStatsRange, parseWeekStart } from "./progress.js";
import type { StatsRange } from "./progress.js";

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
  /**
   * Backs `resolveAuthorizedOwner`'s widening branch (15b-v2, Phase S1) for
   * `GET /trainer/clients/:clientUserId/dashboard`. Same method the
   * `POST /clients/:clientUserId/plan-specs` route's `trainerAccess` deps use
   * (see `plan.ts`) — this route builds the SAME `OwnerAccessDeps` shape
   * inline from `assignmentRepo` + `entitlementReader` rather than adding a
   * separate options field, since both are already top-level options here.
   */
  findActiveAssignment(
    tenantId: string,
    trainerUserId: string,
    clientUserId: string,
  ): Promise<TrainerClientAssignmentDTO | undefined>;
}

/**
 * Local structural port for the trainer dashboard read
 * (`WorkoutSessionRepository.getClientDashboard`, 15b-v2 Phase S1) — the
 * route never imports the DB layer directly (architecture rule
 * `routes-no-db-layer`).
 */
interface TrainerRouteDashboardRepo {
  getClientDashboard(tenantId: string, ownerUserId: string, now?: Date): Promise<ClientDashboardDTO>;
}

/**
 * Local structural port for the batched client-list enrichment
 * (`WorkoutSessionRepository.getClientListMeta`, GH client-list-meta) — the
 * route never imports the DB layer directly (architecture rule
 * `routes-no-db-layer`). One call for the WHOLE roster, never per-client.
 */
interface TrainerRouteClientListMetaRepo {
  getClientListMeta(
    tenantId: string,
    clientUserIds: string[],
  ): Promise<
    Array<{
      clientUserId: string;
      name: string | null;
      lastSessionAt: string | null;
      completionRate: number | null;
    }>
  >;
}

/**
 * Local structural port for the trainer-scoped progress reads (GH #447) —
 * `GET /trainer/clients/:clientUserId/progress/{stats,exercise-detail,
 * weekly-overview}`. Same three `ProgressRouteRepo` methods `progress.ts`'s
 * self-scoped routes call, declared locally (not imported) so this route
 * never imports the DB layer directly (architecture rule
 * `routes-no-db-layer`) — the concrete `WorkoutSessionRepository` (wired in
 * app.ts, the SAME instance `progressRoutes`' `repo` option uses) satisfies
 * this structurally. `tenantId`/`userId` signatures are byte-identical to
 * `ProgressRouteRepo`'s — the resolved owner id (never the actor id) is what
 * gets passed as `userId`.
 */
interface TrainerRouteProgressRepo {
  getStatsRange(tenantId: string, userId: string, range: StatsRange): Promise<StatsSummaryDTO>;
  getWeeklyOverview(tenantId: string, userId: string, weekStart: Date): Promise<WeeklyOverviewDTO>;
  getExerciseDetail(tenantId: string, userId: string, title: string): Promise<ExerciseDetailDTO>;
}

/**
 * Local structural port for the client-facing trainer-plan read
 * (`WorkoutPlanRepository.findLatestReadyByOwner`, 15b-v2 Phase S2 — #283) —
 * the route never imports the DB layer directly (architecture rule
 * `routes-no-db-layer`).
 */
interface TrainerRoutePlanRepo {
  findLatestReadyByOwner(
    tenantId: string,
    userId: string,
  ): Promise<
    | {
        id: string;
        status: string;
        programJson?: unknown;
        planSpecId: string;
        name?: string | null;
      }
    | undefined
  >;
}

/**
 * Local structural port for the confirmed-spec read (`PlanSpecRepository.
 * findConfirmedById`, 15b-v2 Phase S5) — backs `GET /me/trainer-plan`'s
 * branding lookup. The route never imports the DB layer directly
 * (architecture rule `routes-no-db-layer`). Scoped the SAME way the S2 plan
 * read is: `(tenantId, userId, id)` — a cross-tenant or cross-user id matches
 * nothing, so this can never widen the S2 authorization it rides on.
 */
interface TrainerRouteSpecRepo {
  findConfirmedById(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<{ specJson: { branding?: PlanBranding } } | undefined>;
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
  /** Backs `GET /trainer/clients/:clientUserId/dashboard` (15b-v2, Phase S1). */
  dashboardRepo: TrainerRouteDashboardRepo;
  /**
   * Backs `GET /trainer/clients/:clientUserId/progress/{stats,exercise-
   * detail,weekly-overview}` (GH #447). Optional so existing registrations/
   * tests that predate #447 keep compiling unchanged; when absent, these
   * three routes are not registered at all (mirrors `planRoutes`'
   * `trainerAccess`-gated conditional registration in plan.ts).
   */
  progressRepo?: TrainerRouteProgressRepo;
  /**
   * Backs `GET /trainer/clients`'s `name`/`lastSessionAt`/`completionRate`
   * enrichment (GH client-list-meta). Optional so existing registrations/
   * tests keep compiling unchanged; when absent the route serves the base
   * `{ clientUserId, email, status }` shape exactly as before this change.
   */
  metaRepo?: TrainerRouteClientListMetaRepo;
  /** Backs `GET /me/trainer-plan` (15b-v2, Phase S2 — #283). */
  planRepo: TrainerRoutePlanRepo;
  /**
   * Backs `GET /me/trainer-plan`'s branding lookup (15b-v2, Phase S5).
   * Optional so existing test/registration call sites that predate S5 keep
   * compiling unchanged; when absent the route serves the base (unbranded)
   * plan shape exactly as before this slice.
   */
  specRepo?: TrainerRouteSpecRepo;
  /**
   * Optional observability seam (#310). Threaded into every
   * `resolveAuthorizedOwner` / `assertTrainerEntitled` call so an
   * `owner_access.denied` warn event is recorded on trainer-authorization
   * denials. Optional so existing registrations/tests compile unchanged.
   */
  observability?: ObservabilityLogger;
  /**
   * Seat-billing sync port (16c-v3-b2b-seat-billing, Slice C). Fired AFTER the
   * assignment mutation commits on the transitions that change the ACTIVE seat
   * set — accept (invited → active) and revoke (active → revoked). NEVER on
   * invite/create (which yields `invited`, an uncounted seat — design Q3). The
   * route depends only on this structural port; the concrete `SeatSyncService`
   * (billing/seat-sync.ts) satisfies it, wired in app.ts. Optional so existing
   * registrations/tests compile unchanged; absent ⇒ the trigger is a no-op.
   */
  seatSync?: SeatSyncTrigger;
}

/**
 * Structural port for the seat-sync trigger — the route calls only
 * `syncSeats`, so it never imports the billing use case's concrete class.
 */
interface SeatSyncTrigger {
  syncSeats(tenantId: string): Promise<void>;
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
  const {
    assignmentRepo,
    membershipRepo,
    userRepo,
    entitlementReader,
    dashboardRepo,
    planRepo,
    specRepo,
    progressRepo,
    metaRepo,
    observability,
    seatSync,
  } = options;

  /**
   * Fire seat-sync AFTER an active-set transition commits (16c Slice C).
   * FIRE-AND-FORGET (Judgment Day fix, WARNING): the assignment mutation is
   * already committed, so a slow/hanging outbound Stripe call must never add
   * latency to this request's response — the trigger call is intentionally
   * NOT awaited in the route handler. The floating promise's rejection is
   * caught here so it can never surface as an unhandled rejection;
   * `SeatSyncService` already swallows Stripe failures internally, so this
   * `.catch` only guards against a lock/DB failure in the trigger path
   * itself. The reconcile sweep heals any drift (design Q3 fail-safe).
   */
  const fireSeatSync = (tenantId: string): void => {
    if (!seatSync) return;
    seatSync.syncSeats(tenantId).catch(() => {
      // Intentionally swallowed — see doc comment. Never awaited, so this is
      // the only place a rejection can be observed.
    });
  };

  // GET /trainer/clients/:clientUserId/dashboard (15b-v2-trainer-dashboard-
  // branding, Phase S1). `resolveAuthorizedOwner` is the SAME deny-by-default
  // choke point `POST /clients/:clientUserId/plan-specs` uses (plan.ts) —
  // built here from the SAME `assignmentRepo`/`entitlementReader` this file
  // already receives as top-level options (no new `trainerAccess` field
  // needed). Trainer and client always share `ctx.tenantId` for the read
  // (design.md "Tenant-Safe Dashboard Data") — the resolved `ownerUserId` is
  // passed to `getClientDashboard` with the SAME tenantId, never widened.
  fastify.get(
    "/trainer/clients/:clientUserId/dashboard",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = toActorOwnerContext(request);
      const { clientUserId } = request.params as { clientUserId: string };

      let ownerUserId: UserId;
      try {
        ownerUserId = await resolveAuthorizedOwner(
          ctx,
          { assignmentRepo, entitlementReader, observability },
          clientUserId as UserId,
        );
      } catch (err) {
        if (err instanceof ForbiddenOwnerAccess) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      const dashboard = await dashboardRepo.getClientDashboard(ctx.tenantId, ownerUserId);
      return reply.code(200).send(dashboard);
    },
  );

  // GET /trainer/clients/:clientUserId/progress/{stats,exercise-detail,
  // weekly-overview} (GH #447). Registered only when `progressRepo` is
  // wired (see doc comment on the option) — mirrors `planRoutes`'
  // `trainerAccess`-gated conditional registration in plan.ts. Each route
  // resolves `ownerUserId` through the EXACT SAME `resolveAuthorizedOwner`
  // choke point `GET /trainer/clients/:clientUserId/dashboard` above uses
  // (role → tier → ACTIVE assignment, deny-by-default, flat 403 on any
  // failure — never leaking which check failed). The resolved owner id is
  // then passed as `userId` to the SAME `ProgressRouteRepo`-shaped methods
  // the self-scoped `/progress/*` routes call (progress.ts) — same DTOs,
  // same repository signatures, no widening beyond the resolved owner.
  if (progressRepo) {
    fastify.get(
      "/trainer/clients/:clientUserId/progress/stats",
      { preHandler: requireAuth() },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = toActorOwnerContext(request);
        const { clientUserId } = request.params as { clientUserId: string };

        let ownerUserId: UserId;
        try {
          ownerUserId = await resolveAuthorizedOwner(
            ctx,
            { assignmentRepo, entitlementReader, observability },
            clientUserId as UserId,
          );
        } catch (err) {
          if (err instanceof ForbiddenOwnerAccess) {
            return reply.code(403).send({ error: "forbidden" });
          }
          throw err;
        }

        const range = parseStatsRange((request.query as { range?: string } | undefined)?.range);
        const summary = await progressRepo.getStatsRange(ctx.tenantId, ownerUserId, range);
        return reply.code(200).send(summary);
      },
    );

    fastify.get(
      "/trainer/clients/:clientUserId/progress/exercise-detail",
      { preHandler: requireAuth() },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = toActorOwnerContext(request);
        const { clientUserId } = request.params as { clientUserId: string };

        let ownerUserId: UserId;
        try {
          ownerUserId = await resolveAuthorizedOwner(
            ctx,
            { assignmentRepo, entitlementReader, observability },
            clientUserId as UserId,
          );
        } catch (err) {
          if (err instanceof ForbiddenOwnerAccess) {
            return reply.code(403).send({ error: "forbidden" });
          }
          throw err;
        }

        // Same "?title= required" contract as the self-scoped route
        // (progress.ts) — a missing/blank title 400s BEFORE the repo call,
        // regardless of whether the caller was authorized to reach it.
        const title = (request.query as { title?: string } | undefined)?.title;
        if (typeof title !== "string" || title.trim() === "") {
          return reply.code(400).send({ error: "title_required" });
        }

        const detail = await progressRepo.getExerciseDetail(ctx.tenantId, ownerUserId, title);
        return reply.code(200).send(detail);
      },
    );

    fastify.get(
      "/trainer/clients/:clientUserId/progress/weekly-overview",
      { preHandler: requireAuth() },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const ctx = toActorOwnerContext(request);
        const { clientUserId } = request.params as { clientUserId: string };

        let ownerUserId: UserId;
        try {
          ownerUserId = await resolveAuthorizedOwner(
            ctx,
            { assignmentRepo, entitlementReader, observability },
            clientUserId as UserId,
          );
        } catch (err) {
          if (err instanceof ForbiddenOwnerAccess) {
            return reply.code(403).send({ error: "forbidden" });
          }
          throw err;
        }

        const weekStart = parseWeekStart((request.query as { weekStart?: string } | undefined)?.weekStart);
        const overview = await progressRepo.getWeeklyOverview(ctx.tenantId, ownerUserId, weekStart);
        return reply.code(200).send(overview);
      },
    );
  }

  // GET /me/trainer-plan (15b-v2-trainer-dashboard-branding, Phase S2 — #283).
  // `resolveClientTrainerTenant` is the DEDICATED deny-by-default client→
  // trainer-tenant primitive (client-access.ts) — it is NOT
  // `resolveAuthorizedOwner` (that resolver is not symmetric: it widens a
  // TRAINER into a CLIENT's owner-id within the trainer's OWN tenant; here a
  // CLIENT crosses INTO an assigned trainer's tenant, reading only rows keyed
  // to their OWN userId). The resolved `trainerTenantId` is passed to
  // `findLatestReadyByOwner` together with `ctx.actorUserId` — the userId
  // filter is ALWAYS the caller's own id, never widened.
  fastify.get(
    "/me/trainer-plan",
    { preHandler: requireAuth() },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { userId } = request.authContext!;

      let trainerTenantId: string;
      try {
        trainerTenantId = await resolveClientTrainerTenant(
          { actorUserId: userId },
          { assignmentRepo },
        );
      } catch (err) {
        if (err instanceof ForbiddenOwnerAccess) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      const plan = await planRepo.findLatestReadyByOwner(trainerTenantId, userId);
      if (!plan) {
        return reply.code(404).send({ error: "not_found" });
      }

      // 15b-v2 Phase S5: thread the trainer-authored branding (if any) from
      // the confirmed PlanSpec onto the response so the client-facing view
      // can render it. Scoped by the SAME (trainerTenantId, userId) the S2
      // plan read already resolved — never a caller-supplied tenant/user, so
      // this can never widen the S2 authorization. `specRepo` is optional
      // (back-compat for pre-S5 registrations); absent branding or an absent
      // specRepo both render the base (unbranded) plan.
      const specRow = specRepo
        ? await specRepo.findConfirmedById(trainerTenantId, userId, plan.planSpecId)
        : undefined;
      const branding = specRow?.specJson?.branding;

      // Map to the client DTO (see GET /workout-plans/:id in plan.ts): client
      // reads { id, status, program, specId, name } — not the raw DB row.
      return reply.code(200).send({
        id: plan.id,
        status: plan.status,
        program: plan.programJson ?? undefined,
        specId: plan.planSpecId,
        name: plan.name ?? undefined,
        ...(branding ? { branding } : {}),
      });
    },
  );

  // POST /trainer/clients/invite
  fastify.post(
    "/trainer/clients/invite",
    { schema: inviteSchema, preHandler: requireRole("trainer") },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = toActorOwnerContext(request);
      const body = request.body as InviteClientRequest;

      try {
        await assertTrainerEntitled(ctx, { entitlementReader, observability });
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

      // 16c Slice C: the invite is now an ACTIVE (counted) seat — resync the
      // sponsor trainer tenant's Stripe quantity. Fired after the mutation
      // commits; non-fatal AND non-blocking (design Q3 + Judgment Day fix) —
      // never awaited, so a slow Stripe call never delays this response.
      fireSeatSync(assignment.tenantId);

      return reply.code(200).send({ ...assignment, status: "active" });
    },
  );

  // POST /trainer/clients/:clientUserId/revoke (16c-v3-b2b-seat-billing, Slice
  // C). Trainer-initiated revoke of their OWN active assignment to a client —
  // gated by `requireRole("trainer")` + `assertTrainerEntitled` (the same gate
  // invite/list use). Transitions the assignment `active → revoked`, which
  // removes a counted seat, then fires seat-sync to shrink the sponsor's Stripe
  // quantity (design Q3 — the active-set-shrinking transition). The client keeps
  // all existing data; future trainer-mediated generation is denied by
  // `resolveAuthorizedOwner` (no active assignment) exactly as before.
  fastify.post(
    "/trainer/clients/:clientUserId/revoke",
    { preHandler: requireRole("trainer") },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = toActorOwnerContext(request);
      const { clientUserId } = request.params as { clientUserId: string };

      try {
        await assertTrainerEntitled(ctx, { entitlementReader, observability });
      } catch (err) {
        if (err instanceof ForbiddenOwnerAccess) {
          return reply.code(403).send({ error: "forbidden" });
        }
        throw err;
      }

      // Only an ACTIVE assignment owned by THIS trainer in THIS tenant can be
      // revoked — a missing/invited/revoked/cross-trainer row resolves to
      // undefined and yields 404 (never touches another tenant's seat count).
      const assignment = await assignmentRepo.findActiveAssignment(
        ctx.tenantId,
        ctx.actorUserId,
        clientUserId as UserId,
      );
      if (!assignment) {
        return reply.code(404).send({ error: "no_active_assignment" });
      }

      await assignmentRepo.updateStatus(assignment.tenantId, assignment.id, "revoked");

      // The active seat is gone — resync the sponsor's Stripe quantity (floored
      // to max(1, count); the last seat removed keeps quantity 1). Fired after
      // the mutation commits; non-fatal AND non-blocking (design Q3 +
      // Judgment Day fix) — never awaited, so a slow Stripe call never delays
      // this response.
      fireSeatSync(assignment.tenantId);

      return reply.code(200).send({ ...assignment, status: "revoked" });
    },
  );

  // GET /trainer/clients
  fastify.get(
    "/trainer/clients",
    { preHandler: requireRole("trainer") },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = toActorOwnerContext(request);

      try {
        await assertTrainerEntitled(ctx, { entitlementReader, observability });
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

      // GH client-list-meta: enrich with name/lastSessionAt/completionRate in
      // ONE batched call for the whole roster (never per-client). `metaRepo`
      // is optional (back-compat for pre-this-change registrations/tests);
      // absent ⇒ the base ClientSummaryDTO shape ships unchanged. An empty
      // roster short-circuits before calling out at all. A meta-read failure
      // is NOT caught here and propagates like any other repository read in
      // this route (e.g. `assignmentRepo.listByTrainer`/`userRepo.findById`
      // above) — nothing in this handler already tolerates a partial
      // failure, so a broken enrichment source fails the whole request with
      // the default 500 rather than silently shipping unenriched rows.
      if (metaRepo && clients.length > 0) {
        const meta = await metaRepo.getClientListMeta(
          ctx.tenantId,
          clients.map((client) => client.clientUserId),
        );
        const metaByClientId = new Map(meta.map((entry) => [entry.clientUserId, entry]));
        for (const client of clients) {
          const entry = metaByClientId.get(client.clientUserId);
          client.name = entry?.name ?? null;
          client.lastSessionAt = entry?.lastSessionAt ?? null;
          client.completionRate = entry?.completionRate ?? null;
        }
      }

      return reply.code(200).send(clients);
    },
  );
};
