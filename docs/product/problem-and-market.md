# Problem and opportunity

> 🇪🇸 [Versión en español](./problem-and-market_ES.md)

Every figure in this document is sourced and dated. The ones describing the product come from the code; the ones describing the market come from the public sources cited at the end.

---

## 1. The problem

Training with any judgement behind it demands three things most people don't have at the same time: knowing what to do, adapting it to their own body, and sustaining it over time.

**Dropping out is the norm, not the exception.** Half of all gym sign-ups cancel within the first six months, average annual retention is 66.4% — meaning one in three members leaves every year — and 80% of those who join in January quit before five months are out. Among the reasons people give, 41% cite price and 25% life changes, injuries among them.

**Professional support is a minority option, and an expensive one.** Only 23% of US members used a personal trainer in 2024, averaging 21 sessions a year, down from 28 in 2019. In Barcelona a session costs €40–70, and monthly packages at a typical studio run from €200–515. For the vast majority, a trainer is simply out of reach.

**Real bodies have limitations.** Around 1.71 billion people live with some musculoskeletal condition, 570 million with lower back pain, and these conditions are the leading cause of disability worldwide, with lower back pain first in 160 countries. A generic training plan ignores precisely what matters most to the person who needs it.

The conclusion is uncomfortable in how obvious it is: there is an enormous gap between the generic plan anyone can download for free and the personal trainer almost nobody can afford. And that gap widens for exactly the person with an injury, a condition or a mobility limitation, because that is the person who can least afford to follow a generic plan.

---

## 2. The market

Fitness apps generated $3.4 billion in 2025, 24.5% more than the year before, with 540 million users and 888 million downloads.

The relevant figure isn't the size but the composition: heavy download volume, plenty of users, and retention that looks suspiciously like a physical gym's. The sector is good at acquiring and bad at retaining, which is the other face of the same problem.

---

## 3. The competition and its blind spot

The AI-assisted training segment is crowded, and it's worth being honest about that.

| Product | Price | What its AI does | Stated weakness |
|---|---|---|---|
| Fitbod | $12.99–15.99/month · $79.99–95.99/year | Algorithmic rotation of muscle groups, substitutions based on equipment | Recovery signals are less explicit than in dedicated systems |
| Freeletics | $34.99–79.99/period | Bodyweight first; adapts to perceived effort | Adapts to reported effort, not to recovery data |
| SensAI | $6.99/month · $69.99/year | Language model reasoning over sleep, heart rate variability and load; conversational changes mid-workout | Its metrics are self-reported, with no independent verification |
| Future | $199/month | Human trainer who edits the plan | High cost; how fast adjustments happen depends on the trainer's schedule |
| Trainiac | Included with Wellhub | Asynchronous human trainer over text, audio and video | Adjustment depends on the trainer's response time |

Two ends of the range are well covered. At the bottom, cheap algorithmic apps that adjust volume and equipment. At the top, human-trainer services costing twenty to thirty times more, with response latency that depends on a person.

What none of the five documents as a first-order capability is **adaptation to declared physical limitations**. Fitbod substitutes based on available equipment but documents no injury-specific protocols. Freeletics adapts by effort. The human-trainer services can adapt for injury, but at a person's pace and at a person's price.

That's the gap.

---

## 4. The opportunity

A system that treats physical limitation as a first-class input — not as a note the user writes and nobody reads — can offer something in between: the adaptation only a professional provides today, at the marginal cost of a language model.

The opportunity rests on three things.

The first is that the data already exists and nobody uses it: people know what hurts and are willing to say so if it leads anywhere.

The second is that adapting for limitation is exactly the kind of problem where a language model adds real value, because it requires combining an exercise catalogue, a taxonomy of movement patterns, a load matrix by body region, and a natural-language description that no form-based interface captures well.

The third is retention. If people drop out because the plan doesn't fit the body following it, a plan that does fit is a retention lever, not just one more feature.

---

## 5. What this document does not claim

kInorA is a master's thesis project. It has no users, no revenue, and no retention data of its own. Everything above describes an opportunity reasoned from public sources, not a market already won.

The validation still pending is set out in the [next steps document](./next-steps.md), and its first question is the most important one: whether adaptation for limitations produces plans a professional would consider correct.

---

## Sources

- [Fitness App Revenue and Usage Statistics (2026) — Business of Apps](https://www.businessofapps.com/data/fitness-app-market/): 2025 revenue, users and downloads.
- [Gym Membership Statistics — Gymdesk](https://gymdesk.com/blog/gym-membership-statistics): retention and churn, compiling the HFA 2025 Benchmarking Report, the HFA 2025 Consumer Report and a 2024 YouGov survey.
- [Musculoskeletal conditions — World Health Organization](https://www.who.int/news-room/fact-sheets/detail/musculoskeletal-conditions): global prevalence, 2019 data.
- [How Much Does a Personal Trainer in Barcelona Cost? — Roei's Studio](https://roeis.es/personal-trainer-cost-barcelona.html): personal training prices in Spain.
- [Best AI Fitness Apps in 2026 — SensAI](https://www.sensai.fit/blog/best-ai-fitness-apps-2026-fitbod-freeletics-future-trainiac-alternatives): competitor prices and capabilities. Worth noting that the source belongs to one of the products compared, so its assessments are not neutral; what has been taken from it are the prices and stated capabilities, not the judgements.
