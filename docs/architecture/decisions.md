# Architecture decision catalogue

> 🇪🇸 [Versión en español](./decisions_ES.md)

Distilled from the forty-two changes archived under `openspec/changes/archive/`. The design documents add up to 578 KB and hold **more than a hundred and sixty decisions**, each with its context, its alternatives and the reason they were dropped.

This catalogue does not reproduce them all: it collects the ones with structural consequences and, above all, extracts the patterns that keep recurring. The full record, audit trail included, still lives in the `openspec` archive.

---

## 1. Why this record exists

The project follows a spec-driven cycle: propose, specify, design, break down into tasks, apply, verify and archive. The design phase requires decisions to be documented together with their reasoning, and the configuration says so explicitly: *"Document architecture decisions with rationale"*.

The side effect is a record of why the system is the way it is, written **before** the code and not reconstructed afterwards. That is the difference between a justification and a rationalisation.

---

## 2. Foundations

**Layer isolation is verified, not declared.** Clean architecture said the domain could not depend on infrastructure, but nothing actually prevented it. `dependency-cruiser` was brought in with forbidden rules wired into the `build`. Extending the in-house guard was dropped because *"hand-rolled scanning is brittle for TS aliases and relative imports"*, and `eslint-plugin-boundaries` because it drags the whole ESLint configuration along with it. A layer violation breaks the build with a named error.

It was reinforced with an executable proof: a test showing that a use case runs with no framework, no UI, no network and no database, written red first.

**Domain and contracts are separate packages.** Putting the domain inside the API was dropped because it has to be reusable *"by API, web, and future mobile shell without framework coupling"*. And contracts cannot live inside the domain because they are more stable and the UI consumes them without dragging use cases along. The `contracts-no-workspace-deps` rule keeps them a leaf of the graph.

**Exact versions and a pinned runtime.** No caret ranges: *"exact versions ensure reproducible installs"*.

---

## 3. Multi-tenancy and authorization

**Membership instead of a tenant column.** A mandatory `users.tenantId` would have been shorter, and it was dropped because *"membership avoids the single-tenant shortcut and supports future Trainer/B2B access"*. Two versions later, that decision is what lets a client belong to their own personal tenant and their trainer's at the same time.

**Tenant context is mandatory at the repository.** Methods on tenant-scoped entities require a context that is validated before reaching the ORM, so its absence fails **before** persistence is touched. The alternative — an optional parameter or a global convention — was dropped because it cannot be demonstrated in a test.

**404, not 403, for someone else's resource.** Reads require the tenant/user/id triple and return absence, which the routes translate into *not found*. It was chosen over 403 because it *"avoids resource existence leaks"*. A 403 response confirms that the resource exists.

**A single decision point for trainer access.** Once a trainer is allowed to operate on their client's data, the check could have been repeated in every repository method. That was dropped because it scatters the control across some eight methods with a high risk of forgetting one. Instead, a single resolver in the route layer: *"Single choke point = deny-by-default and provable"*. An impersonation service that swapped the session identity was also dropped, as novel and hard to review.

**Reverse access does not reuse the same resolver.** When the client needs to read the plan their trainer created in another tenant, a separate primitive and a route of its own were created, because the relationship is not symmetric. The alternative was switching the tenant at sign-in, and it was dropped with a sentence that stands in for the entire risk analysis: *"changes the session tenant for ALL requests of EVERY dual-membership user — a broad blast radius on the core sign-in surface"*. Final cost: zero lines changed in the authentication flow.

**Membership revalidation on every request.** The session is not enough: membership is always re-read and access denied if it is not active, closing the window in which a suspended person would keep access until their token expired.

---

## 4. Identity

**Opaque database sessions over JWTs.** The stateless token was dropped because *"JWT makes revocation and stale tenant claims harder"*. The price is one query per request; the gain is immediate revocation and tenant changes that take effect instantly.

**scrypt instead of Argon2id.** Here the decision is honest and annotated as such: Argon2id is the preferred algorithm today, and it was rejected over library maintenance concerns. What remains is `crypto.scrypt` from Node's core — memory-hard and OWASP-recommended.

**Generic OIDC from the very first provider.** Google is the first implementation, not the only one anticipated: the `oauth_accounts` schema is generic, and adding a provider should be *"a config entry + OIDC issuer metadata, not flow changes"*. Account linking requires a verified email, which closes off account takeover via unconfirmed addresses.

**Protection in the Next middleware is UI-only.** The document says so itself: it is *"frontend only"* and does not constitute a fail-closed control against a 401 from the API. Acknowledging a layer's limit is worth more than pretending it has none.

---

## 5. Data

**A relational snapshot when the workout starts.** The generated plan lives as mutable JSON. Storing only indices into it was dropped because copying the planned context into its own tables *"preserve[s] workout history after regenerate/edit and keep[s] tracker reads relational instead of coupled to mutable JSON"*. Information is duplicated on purpose so that history survives a regeneration.

**Explicit names to avoid semantic collisions.** `sessions` already meant authentication tokens, and `WorkoutSession` already meant a day of the plan. Hence `workout_sessions`, `session_exercises` and `set_records`. Verbose and unambiguous.

**Invariants in the database.** One active session per user is a partial unique index, not a service-level validation. Two versions later, when offline sync and the automatic closing of stale sessions arrive, that index is what stops a race condition from creating an impossible state.

**A breaking change in place, no additive fields.** When `PlanSpec` was modified, adding an optional field or creating a parallel type was dropped, because the monorepo compiler *"catches all consumers atomically; no permanent cruft"*. It is the opposite of the usual call, and it is justified by having a single repository with global type checking.

**Additive, reversible migrations.** Nullable columns, no backfill, with the rollback defined as a lossless column drop. The pattern repeats in the plan name, the session day, the muscle group, the body metrics and archiving.

**Archive instead of delete, with the filter in the repository.** Putting the filter in the route or in the page was dropped with a sentence worth quoting: *"a default that must be requested at every call site is not a default"*. And the ban on deletion is reinforced by a test that names `plan_specs` explicitly, because its cascade would reach all the way down to recorded sets and destroy history without touching a single plan route.

---

## 6. Artificial intelligence

**A port before a provider, from day one.** Model access was defined behind a port and the output is schema-validated rather than parsed as raw JSON. A specific provider's SDK was dropped so as not to commit to a single vendor.

**Asynchronous generation without queue infrastructure, with the cost written down.** A real queue was dropped because this is a single-node v1, and the document owns the price: a restart loses in-flight generations and leaves plans stuck. It is not dressed up as a harmless decision.

**Memory retrieval lives in the service, not the adapter.** Mutating the prompt inside each adapter would have broken the port. Placing it earlier also lets it fail open without ever reaching the traces.

**Vector memory in the existing Postgres.** An external vector database was dropped because staying on Postgres preserves *"tenant/user predicates, cascade deletion, migrations, and rollback inside the existing Postgres/Drizzle model"*.

**Memories only on explicit confirmation.** Automatic extraction from the conversation was dropped over the risk of capturing raw transcripts, secrets and health data. Coverage is lost; privacy by design is gained.

**The embedding provider is persisted with every row.** Pinning the model in code was dropped because changing it would silently invalidate the store. By storing model, version and dimension on the row, an incompatible cohort is excluded explicitly instead of returning meaningless results.

**Reject the whole remote template, never repair it.** Once prompts were externalised, a badly edited template could break the product. Boundary validation rejects and falls back to the compiled version; repairing a relocated section was dropped because *"relocated closed-vocabulary section is rejected, not repaired"*: order is contract. A prompt-manager outage cannot stop generation.

**Template dialect reduced to literal substitution.** Mustache, Handlebars and LangChain's template engine were all dropped, the last of them because it *"would also reinterpret the JSON braces in the output-format block"*. The renderer fits in fifteen lines and is demonstrably total.

**Trace redaction happens in the SDK hook.** Masking before the call is impossible for body metrics, because it would strip them from the model too. A per-request registry with async context was dropped on the decisive argument that it *"fails open if context is ever lost, which is unacceptable for a privacy control"*. A per-request handler was also dropped, for fragmenting the flush lifecycle.

**And in case the rule fails, a value check.** At the call site the system verifies that redaction really did hide the text; if not, the section is omitted and generation proceeds with the previous prompt. Faced with a privacy failure the system degrades to a worse plan, never to a leak.

**Body data goes into exactly one prompt.** Feeding it to the conversation and extraction prompts as well was dropped because extraction turns chat into a draft, and physiology adds nothing there: it would widen exposure for no gain. And no new required placeholders were added, because doing so would force every template predating the change to fail validation — *"a self-inflicted outage for a purely additive variable"*.

---

## 7. Offline operation

**The browser never calls the API directly.** It queues in local storage and, once connectivity returns, invokes the existing server actions. Short-lived client tokens were dropped for widening the security model. The exception was drafted with surgical precision: the browser may persist mutations and defer the call, but it still does not talk to the API.

**Ordering by a monotonic counter, not by the clock.** Using the timestamp was dropped because millisecond resolution ties on fast taps. The flush is strictly sequential and concurrent dispatch is *"explicitly forbidden"*.

**Two fixes that came out of it.** Without mutual exclusion, overlapping triggers broke sequentiality. And without atomic counter allocation, two tabs computed the same number and one mutation was silently lost.

**A failure taxonomy instead of a generic error.** Retryable, poison message and action-expired-by-redeployment are all distinguished. The previous version discarded poison mutations *"with zero UI feedback"*, making the user's change vanish without warning. That was an integrity defect, not a presentation one.

**The local snapshot is a cache, not a second source of truth.** Any merge logic or CRDT was deliberately dropped: the queue remains the sole authority over pending writes.

**Namespacing by identity, not by token.** Deriving the key from the token hash was rated a critical defect for two reasons: the token rotates on every sign-in, so users wiped their own queue simply by logging back in; and that hash is exactly the API's internal correlator, and exposing it to the client is a needless leak.

---

## 8. Billing

**State is anchored to the tenant, not the user.** Consumption must not follow the person when they change organisation.

**Consumption in a single transaction.** Membership, entitlement, tenant counter, member counter and ledger entry all go together. Separate checks were dropped because they allow partial consumption and overconsumption under concurrency.

**An explicit boundary between the entitlement model and the payment integration.** The change that defined plans and quotas introduced **not one** Stripe field, so that the later integration could map the provider's events without contaminating the internal contracts.

**The payment SDK lives in a single file.** A pure port plus one adapter, with an architecture rule that enforces it. The alternative made the code untestable without a real Stripe.

**Raw body scoped to the webhook only.** A global parser was dropped because it would break every JSON route. The route is unauthenticated because *"the signature IS the auth"*.

**Idempotency and tolerance for out-of-order delivery.** A processed-events table with insert-ignoring-duplicates, a timestamp ordering guard, and any error returning 5xx **without ever granting** the paid tier.

**Denial with 403, not 402.** The payment-required code was dropped because *"402 appears NOWHERE in this codebase"* and it would fork denial handling in the web app for no gain.

---

## 9. Product: don't fabricate data

This is the thread that recurs most, and the one that says most about the judgement the system was built with.

Plan day labels say "Day 1, Day 2" rather than weekday names, because the model has no anchor to the calendar and *"fabricating weekday names would be misleading"*.

A dashboard metric that cannot be computed is left visibly empty rather than filled with an estimate dressed up as data.

The weekly board has no "missed day" state. Adherence is communicated as a percentage and a suggestion, never as a reproach, and a past training day with no session is shown as rest.

When the system automatically closes a stale session, the completion timestamp is left null, because writing it would be *"the same falsehood as writing status='completed', one column over"*.

Recent work follows the same line: fabricated availability data was pulled out of the plans UI and mock copy was replaced with real data.

A product that prefers a gap to an invented number is a product you can trust.

---

## 10. Recurring patterns

Read together, the hundred-and-sixty-odd decisions cluster into eight criteria applied over and over.

**A narrow port to cross a boundary without coupling.** It shows up in the billing gate inside the AI layer, in the payment gateway, in object storage, in connectivity detection and in the embedding generator. Always the minimal interface, always a single adapter that knows the details.

**Fail closed on security and privacy; fail open on accessory capabilities.** Authorization, the payment webhook and trace redaction fail closed. Vector memory, tracing and remote prompt resolution fail open. The distinction is deliberate and argued case by case.

**The invariant is expressed in the database.** A partial unique index for the active session, check constraints for time windows, counters and colours. A service bug cannot leave an impossible state behind.

**A single decision point.** Session validation lives in one function shared by HTTP and WebSocket. Trainer authorization lives in one resolver. Dependency composition lives in one file. Repeating a check multiplies the odds of forgetting it.

**Reject rather than repair.** Faced with an invalid remote template, the answer is not to fix it but to discard it whole and use the local one.

**Re-derive on the server whatever the client proposes.** When accepting an adaptation, the server recomputes the recommendation from history. When editing a programme, it discards the catalogue ids that were sent and resolves them itself. And it preserves safety warnings by ignoring whatever arrives, because allowing them to be edited would let a clinical warning be silently deleted.

**Additive and reversible by default.** Nullable column, optional field, no backfill, rollback by dropping the column. And when it cannot be, as in the breaking contract change, there is an argument for why the compiler makes breaking it safe.

**Tell a product decision apart from a technical failure.** A billing denial is never used as error recovery. An archived plan does not return the same *not found* as a plan that never existed. Collapsing the two is the natural mistake, and it is avoided explicitly.

---

## 11. What this record demonstrates

An examining board asking why the system is the way it is has a written answer to more than a hundred and sixty questions, complete with the alternative that was considered and the reason it was closed off.

The hardest thing to fake is coherence. The eight criteria in the previous section are not stated anywhere in the repository: they emerge from decisions taken at forty-two separate moments across seven weeks. That they converge is the evidence that there was a method, and not a run of convenient decisions.
