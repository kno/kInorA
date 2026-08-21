# Metrics and retrospective

> 🇪🇸 [Versión en español](./metrics-and-retrospective_ES.md)

All figures are measured on `origin/main` as of 10 August 2026 and are reproducible with the corresponding git commands.

---

## 1. The figures

| Metric | Value |
|---|---|
| Development window | 20 Jun → 10 Aug 2026, 52 days |
| Authorship | one person |
| Commits | 714 |
| Merged pull requests | 173 |
| Versioned lines | 318,732 |
| Code files | 502 |
| Test files | 491 |
| Integration suites | 26 |
| End-to-end scenarios | 13 |
| API function coverage | 94.35% with a database, 91.51% without |
| Live specifications | 44 |
| Archived changes | 42 |
| Markdown documents | 337 |
| Database migrations | 31 |
| Tables | 29 |

Average pace: **13.7 commits and 3.3 pull requests per calendar day**. Average pull request size: **12.5 files**.

## 2. The real pace

| Week | Commits |
|---|---:|
| W25 (20-22 Jun) | 39 |
| W26 | 130 |
| W27 | 104 |
| W28 | 66 |
| W29 | 41 |
| W30 | 182 |
| W31 | 71 |
| W32 | 70 |
| W33 (to 10 Aug) | 11 |

It is not a constant pace, and that too is a data point. Week 26 starts strong with the foundations, there is a trough in weeks 28 and 29 — which coincides with the AI generation and tracking work, where design weighs more than code — and a peak in week 30 with user memory, billing and conversational chat.

The breakdown by day of the week says something more:

| Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---:|---:|---:|---:|---:|---:|---:|
| 85 | 119 | 79 | 114 | 33 | 142 | 142 |

**40% of the commits land at the weekend** and Friday is by far the weakest day. This is not a full-time project: it is a project built in the gaps, and the volume figures have to be read with that context in front of you. It makes the result more remarkable, not less.

## 3. Documentation density

Of the 337 markdown documents, 286 live under `openspec/`. In other words, **85% of the project's documentation is process documentation**: proposals, designs, tasks, verification reports and archive reports.

That proportion is the method's signature. In a conventional project the ratio would be the other way round.

---

## 4. What worked

**The spec-driven cycle was the multiplier.** Not out of bureaucracy, but because the exploration phase repeatedly kept the work from being built on false premises. In a single change, exploration discovered that the mobile app had no profile screen, that the weight series had a different shape, that the change would rewrite history and that there was a privacy leak channel the issue never mentioned. Discovering that before writing any code is worth more than any gain in writing speed.

**The contract with the agents worked because it was maintained.** `AGENTS.md` is not an opening document: it accumulates rules written after watching something specific fail, from a package export condition to the ban on fabricating test results.

**The automated guards made the volume viable.** Seven checks that free the reviewer from holding mechanical correctness in their head, and a coverage gate designed not to be skipped.

**Adversarial review found what the tests did not.** The four defects Judgment Day corrected in the offline work — flush reentrancy, silent discard from the user's point of view, identity key derivation and the classification of the expired session error — broke no assertion. They broke guarantees. At high volume, that is the kind of failure that costs the most.

**The ports paid off early.** The multi-provider AI architecture looked like over-engineering at change 08. Four changes later there were five generation providers, three voice providers per direction and a dashboard to switch between them live, without touching the domain.

---

## 5. What cost more than expected

**Offline operation.** It is by far the hardest area. It required its own hardening change after the main one, four adversarial review corrections, a complete error taxonomy and thoroughly non-obvious decisions about ordering, idempotency and namespacing by identity. A problem that looks like local storage and turns out to be distributed systems.

**Syncing with the design system.** The decision was to refresh from the live source before touching any interface, rejecting the use of a stale snapshot. It is the right decision and also a dependency on the critical path. Several later changes are still design alignments.

**Environment variables that never reach the container.** Docker Compose only injects into a service the variables listed in its `environment:` block. A variable the code reads, correctly defined in the server's `.env` file and absent from that block, **is silently ignored**: the container starts without error and the code uses its compiled-in default, so the configuration looks applied and is not.

That failure repeated three times. First with the Stripe keys, which left billing unconfigured in production. Then with the voice provider selection variables, which made the container ignore the operator's choice and always fall back to OpenAI. And then with the Deepgram ones. The documentation written during this work found a fourth occurrence still outstanding, in the Gemini voice tuning variables.

It is a particularly expensive class of failure because **none of the seven guards catches it**: the types compile, the tests pass, the architecture is correct and the application starts. It only manifests in production, and its symptom is plausible default behaviour rather than an error.

**Calibrating the coverage gate.** It took two iterations: first measuring it against a real database, then making it mode-aware. That is the price of having wanted an honest gate rather than a comfortable one.

---

## 6. What I would do differently

**Instrument cost from day one.** Langfuse arrived at change 16e, almost at the end. Having cost per generation from change 08 would have informed plan sizing with data instead of estimates, and would have turned provider choice into a measured decision.

**Define the quality metric for generated plans earlier.** It still does not exist. It is the project's most important gap: there is an architecture that lets you swap models with one click and no way of knowing whether the swap improves the product. It should have been tackled alongside generation, not afterwards.

**Pick a single mobile route.** The Expo app and the Capacitor wrapper coexist. The second is a legacy of an earlier strategy and today it is ambiguity with no clear use.

**Make it a contract rule that adding an environment variable means three edits, not one.** Whoever adds a variable the code reads must, in the same change, declare it in `.env.example`, document it in the variable reference and **add its forwarding line to the `environment:` block in `docker-compose.yml`**. That third edit is the one forgotten four times, and it is the only one that decides whether the configuration actually reaches the container.

Today the rule exists and is written in all three places, but it arrived after the four incidents. It should have been in `AGENTS.md` from the very first environment variable, alongside the rest of the completeness rules, instead of being learned through production failures. And better still than documenting it would have been checking it: a guard comparing the variables the code reads against the ones Compose forwards would turn a silent omission into a broken build.

---

## 7. What this project suggests about building with agents

Three conclusions, offered as reasoned hypotheses and not as demonstrated results, because this is one case, not a study.

**The bottleneck shifts from writing to deciding and verifying.** When writing code stops being the expensive part, the expensive part becomes knowing what to ask for and checking that what arrives is correct. The five phases surrounding implementation in this cycle are exactly that answer, and pull request size is calibrated not by what an agent can write but by what a person can review.

**Automated guards are the condition of possibility, not a best practice.** Without type checking, tests, architecture, dependencies and coverage running on their own, volume produces debt at the same rate it produces functionality.

**Tests check what occurred to you; adversarial review looks for what did not.** The most expensive defects that showed up here broke no assertion. At this pace, a process that actively hunts for the flaw matters more than one that confirms the success.

And a warning. None of this removes judgement. The method is not about the AI deciding: it is about building the scaffolding that lets a person decide much faster without deciding worse. When the scaffolding fails — a variable not forwarded, a false premise not explored — the error gets in all the same, and it gets in faster than before.
