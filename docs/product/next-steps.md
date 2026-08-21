# Improvements and next steps

> 🇪🇸 [Versión en español](./next-steps_ES.md)

Ordered by what would block a launch first, not by what would be most fun to build first.

---

## 1. Blockers for a real launch

**There is no transactional email.** No email-sending integration exists in the repository. Without it there's no address verification, no password recovery, no trial-expiry notice, no payment receipt. It's the largest gap between the current state and a product you can put in front of a paying user.

**Cost per user isn't measured.** The Pro tier caps are set as a safety ceiling rather than derived from observed consumption. Langfuse already traces the model, tokens and latency of every call, so what's missing is aggregating that trace per tenant and setting it against the price. Without that figure, any price is guesswork.

**Object storage writes to the VPS filesystem.** The port is well defined and the adapter is swappable, but in production the directory has to be mounted on a volume outside the image so logos survive a redeploy. Today that's an operational condition that depends on someone remembering it.

**In-flight generation is lost on restart.** Execution is in-process and queueless, a conscious decision for a single-node deployment, with the cost noted in its own design document: a restart leaves plans stuck in the generating state. With one user that's an annoyance; with a thousand it's an incident.

---

## 2. Product: closing what's open

`16c-v3-b2b-seat-billing`, per-seat billing, is in progress. `16b-v3-gym-admin-multigym`, gym administration with aggregate analytics and multi-site support, is specified and not started. These are the two pieces missing for the Gym tier to be a sellable product rather than a technical capability.

There is also a product decision explicitly deferred: **how training days are spread across the week**. Today the board places planned sessions in the first available slots starting from Monday as a display convention, because the model has no anchor to the calendar. Solving it properly means letting the person choose their days, and that touches the data model.

Along the same lines, **all grouping by day and week is computed in UTC**, with no per-user time zone. Someone training at night outside UTC may see a day shifted on the board or a streak boundary offset. The pure functions already accept the time reference as a parameter, so the change isn't breaking, but it requires a time zone column and a migration.

---

## 3. Identified technical debt

**Exercise name normalisation doesn't merge synonyms**, so two ways of naming the same movement produce separate personal records and fragment the history. It's documented as a known limitation in its own design.

The **muscle group classifier** labels from the free-text title. Titles it doesn't recognise are left unclassified and excluded from the distribution, which is correct; the problem is that improving the classifier doesn't fix rows already labelled wrong, because the backfill only reaches the null ones. A versioned reclassification will be needed.

`GOOGLE_TTS_STYLE_DIRECTIVE` **isn't configurable inside a container**, because the synthesiser resolves it with an operator that treats the empty string as a valid value, and Compose interpolates an undefined variable as an empty string. Making it configurable requires the adapter to treat empty as absent.

There is a **duplicate change folder** in `openspec/changes/`, left over from an incomplete archiving. It's cosmetic but it clutters the source of truth.

And there are two mobile paths coexisting: the native app with Expo and the Capacitor wrapper around the web build. It's worth deciding whether the second still serves a purpose or is legacy to retire.

---

## 4. The questions an examining board will ask

These aren't tasks, they're open lines of inquiry. They deserve a place in the thesis precisely because they don't have answers yet.

**How do you measure whether a generated plan is good?** It's the most important question in the project and today there's no metric for it. There's no automatic way to know whether switching models improves or worsens the plans: latency and cost can be measured, quality can't. A reasonable path would be a rubric scored by professionals over a fixed set of cases, including cases with limitations, allowing providers to be compared on something beyond price. The architecture already makes this easy: switching provider is one click, so all that's missing is the criterion.

**Is adaptation for limitations safe?** The system produces warnings and substitutions, never a diagnosis, and that boundary is well defended in the code. But it hasn't been validated by healthcare professionals against real cases. That would have to happen before selling the feature as a differentiator.

**Which provider is the right one?** It's now a reversible operational decision, which is a considerable advantage. What's missing is the experiment to inform it: the same set of cases, several providers, a comparison of quality, cost and latency.

**Does memory improve the plans?** Persistent memory is a stated differentiator. Nobody has yet checked whether a plan generated with memory is better than one generated without it. It's a question a modest A/B experiment could answer, and it would be one of the more interesting contributions of the work.

---

## 5. If three things had to be chosen

Instrument cost per user, because without it the business model is a hypothesis.

Define a quality metric for generated plans, because without it the multi-provider architecture is a capability that can't be exploited.

Integrate transactional email, because without it there's no product to launch.

All three are small compared with what's already built, and all three separate a finished academic project from a product that can take on its first paying user.
