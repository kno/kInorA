# API reference

> 🇪🇸 [Versión en español](./api-reference_ES.md)

A REST API on Fastify 5, plus a WebSocket channel. Endpoints are registered under `apps/api/src/routes/` and composed in `app.ts`, which is the system's single composition root.

---

## 1. Authentication

Protected routes use the `requireAuth()` `preHandler`. The client presents a session token as a `Bearer` credential; only its hash is stored in the database.

The validation chain is one chain in one place, `apps/api/src/auth/plugin.ts`: format check, hash, session lookup, expiry check, tenant and user resolution, and membership revalidation.

That last check is an explicit security decision. Membership is re-read on **every** request and access is denied unless its status is active, which closes the window in which someone suspended after their session was issued would keep access until the token expired. Revalidation is scoped by tenant: it looks up the tenant-user pair, not just the user.

The WebSocket channel receives the token as a query parameter and **uses exactly the same function**, so there is no second validation chain that could drift.

`tenantId` and `userId` come from the authentication context. Neither is ever read from the request body; the service signatures document this.

Admin routes add `requireAdmin`, which relies on the user's `is_admin` flag. There's no UI for granting it: it's done via direct SQL, as documented in `apps/api/README.md`.

---

## 2. Conditional registration

Many routes **are only registered if their port has been injected**. If `app.ts` doesn't build the conversational extractor, the chat route simply doesn't exist, and the card-based assistant routes keep working exactly as before.

This serves two purposes at once. It's a seam for tests, which can bring up the application without stubbing dependencies they aren't going to use. And it's a progressive rollout mechanism: a half-built capability doesn't expose a route that returns an error, it just doesn't show up.

---

## 3. Authentication and account

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | Sign-up with email and password, subject to password policy |
| POST | `/auth/login` | Returns a session token |
| POST | `/auth/logout` | Invalidates the session |
| GET | `/auth/identity` | Session identity and tenant |
| GET | `/auth/profile` | Profile of the authenticated person |
| GET | `/auth/social/login` | Start of the Google OIDC flow |
| POST | `/auth/social/callback` | Flow return; links by email if the account already exists |

## 4. Planning

| Method | Path | Notes |
|---|---|---|
| POST | `/plan-specs/drafts` | Saves the assistant's draft, with a version token |
| GET | `/plan-specs/drafts/current` | The user's current draft |
| POST | `/plan-specs` | Promotes the draft to a specification |
| POST | `/plan-specs/:id/confirm` | Confirms and starts generation |
| POST | `/plan-specs/:id/regenerate` | Regenerates from the same specification |
| POST | `/plan-specs/:id/adapt` | Adaptation based on adherence and RPE |
| GET | `/plan-specs/:id/workout-plan` | Plan generated from that specification |
| POST | `/plan-specs/chat` | A conversational assistant turn |
| POST | `/plan-specs/transcribe` | Audio to text |
| POST | `/plan-specs/speech` | Text to audio |
| GET | `/workout-plans` | Plan listing |
| GET | `/workout-plans/:id` | Detail |
| PUT | `/workout-plans/:id/program` | Program editing |
| POST | `/workout-plans/:id/archive` | Archive |
| POST | `/workout-plans/:id/unarchive` | Restore |
| POST | `/clients/:clientUserId/plan-specs` | Create a plan for a client, Trainer tier |
| GET | `/clients/:clientUserId/workout-plans/:id` | A client's plan |

Plans are never deleted: they're archived. Editing uses an integer, monotonic version token, which makes concurrent writes detectable.

## 5. Training

| Method | Path | Notes |
|---|---|---|
| POST | `/workout-sessions` | Starts a training session |
| GET | `/workout-sessions/:id` | Detail |
| GET | `/workout-sessions/history` | History, including abandoned sessions in read-only form |
| PATCH | `/workout-sessions/:id/sets/:setId` | Logs a set |
| POST | `/workout-sessions/:id/complete` | Closes with overall RPE and notes |
| POST | `/workout-sessions/:id/abandon` | Explicit abandonment |
| DELETE | `/workout-sessions/:id` | Discard |
| DELETE | `/workout-sessions` | Discards the active session |

A unique index in the database guarantees that a person can't have two active sessions at once, so an offline client syncing up can't create an impossible state.

## 6. Progress

| Method | Path |
|---|---|
| GET | `/progress/dashboard` |
| GET | `/progress/stats` |
| GET | `/progress/weekly-overview` |
| GET | `/progress/exercise-detail` |

## 7. User context

| Method | Path | Notes |
|---|---|---|
| GET · PUT | `/user-profile` | Goal, level, self-declared sex, height |
| GET · POST | `/weight-entries` | Weight time series |
| GET · PUT | `/user-preferences` | Defaults and voice |
| GET · POST | `/user-memories` | Assistant memory |
| DELETE | `/user-memories/:id` | Deletes a single memory |
| PATCH | `/user-memories/settings` | Turns memory on or off |

People can read, add and delete their own memory. It isn't a black box.

## 8. Exercise catalog

| Method | Path |
|---|---|
| GET | `/exercises/catalog` |
| GET | `/exercises/catalog/facets` |
| GET | `/exercises/catalog/:id` |

## 9. Billing

| Method | Path | Notes |
|---|---|---|
| GET | `/billing/pricing` | Public page pricing |
| GET | `/billing/visibility` | What should be shown to this tenant |
| GET | `/billing/usage` | Consumption against limits |
| PUT | `/billing/allocations` | Quota split across members |
| POST | `/billing/checkout` | Stripe checkout session |
| POST | `/billing/portal` | Customer portal |
| GET | `/billing/invoices` | Invoices |
| POST | `/billing/webhook` | Stripe event intake |

The webhook is registered **twice**, unprefixed and under `/api`. The reason is annotated in `app.ts`: only the prefixed variant is reachable from outside through the proxy, and without that second registration Stripe couldn't deliver events.

Idempotency is handled by the `stripe_processed_events` table, indexed by event identifier, and ordering by the event timestamp stored in the tenant's state.

## 10. Trainer and white label

| Method | Path | Notes |
|---|---|---|
| GET | `/trainer/clients` | Assigned clients |
| POST | `/trainer/clients/invite` | Invitation |
| POST | `/trainer/clients/accept` | Acceptance by the client |
| POST | `/trainer/clients/:clientUserId/revoke` | Revocation |
| GET | `/trainer/clients/:clientUserId/dashboard` | Client progress |
| GET | `/me/trainer-plan` | Assigned plan, from the client's view |
| GET · PUT | `/branding` | Tenant branding |
| GET | `/media/branding/:key` | Logo served from storage |
| GET | `/public/branding/by-slug/:slug` | Public branding by subdomain, unauthenticated |

## 11. Administration

| Method | Path | Notes |
|---|---|---|
| GET · PUT | `/admin/ai-config` | Active AI provider and model |
| GET | `/admin/tenants` | Tenant listing |
| GET | `/admin/tenants/:tenantId/tier-override` | Current override |
| POST | `/admin/tenants/:tenantId/tier-override` | Grant a tier manually |
| POST | `/admin/tenants/:tenantId/tier-override/revoke` | Revoke |
| GET | `/admin/stats` | Platform metrics |
| GET | `/admin/logs` | Observability events |

## 12. Health and real time

| Method | Path | Notes |
|---|---|---|
| GET | `/health` · `/api/health` | Probe used by Compose and by the pipeline |
| GET | `/ws/plans` | WebSocket: notification that a plan is ready or failed |

The WebSocket channel is what makes it possible to answer the generation request immediately and notify afterwards, without the client having to poll.
