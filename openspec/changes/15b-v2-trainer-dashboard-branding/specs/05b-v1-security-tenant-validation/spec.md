# Delta for 05b-v1-security-tenant-validation

## ADDED Requirements

### Requirement: Client-to-Trainer-Tenant Read Authorization

A client MUST be able to read plan rows owned by their own `userId` inside an assigned trainer's tenant, through a single deny-by-default resolver (`resolveClientTrainerTenant`), without any change to normal login, session establishment, or the existing self-only `(tenantId, userId)` read path for any user. The resolver MUST look up the caller's client-side `trainer_client_assignments` row by `clientUserId === ctx.actorUserId`, deny (`ForbiddenOwnerAccess`, flat 403) unless a row exists with `status === "active"` and `clientUserId === ctx.actorUserId`, and otherwise return that row's trainer `tenantId`. Every downstream repository read MUST use the resolved trainer `tenantId` filtered by `ctx.actorUserId` — the `userId` filter MUST NEVER be widened to any other user's id. `selectActiveTenant` MUST remain unwired from login/session (`service.ts`, `social.ts`, `plugin.ts`); no session or login byte changes for any user, including non-client, non-trainer users.

#### Scenario: Client reads own plan in trainer's tenant

- GIVEN a client has an active assignment to trainer T, and a ready plan exists in T's tenant owned by the client's `userId`
- WHEN the client requests their trainer plan
- THEN `resolveClientTrainerTenant` returns T's `tenantId` and the plan read filtered by `(T's tenantId, ctx.actorUserId)` succeeds

#### Scenario: Client A cannot read Client B's data

- GIVEN client A and client B are both assigned to trainer T within T's tenant
- WHEN client A requests the trainer-plan read
- THEN the repository filter uses only `ctx.actorUserId` (A), so no row owned by B's `userId` can ever be returned

#### Scenario: Client cannot read beyond their assigned trainer

- GIVEN a client is assigned only to trainer T and has no assignment to trainer U
- WHEN the client attempts to read a plan located in trainer U's tenant
- THEN `resolveClientTrainerTenant` resolves only T's `tenantId` (the client's single active assignment), so no read against U's tenant is possible

#### Scenario: Revoked or missing assignment denied

- GIVEN a client's `trainer_client_assignments` row has `status` other than `"active"`, or no row exists for the client
- WHEN the client requests the trainer-plan read
- THEN `resolveClientTrainerTenant` throws `ForbiddenOwnerAccess` and the response is a flat 403 with no repository call

#### Scenario: Normal user self-only access and login unchanged

- GIVEN a user with no trainer/client relationship uses any existing self-only route, or any user logs in
- WHEN the request or login is processed
- THEN behavior is byte-identical to before this change: `selectActiveTenant` is not invoked, and self routes resolve owner strictly to `ctx.actorUserId` against the session tenant
