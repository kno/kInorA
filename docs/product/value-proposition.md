# Value proposition and users

> 🇪🇸 [Versión en español](./value-proposition_ES.md)

---

## 1. The one-liner

kInorA generates and adapts training plans to each person's real body — their goals, their level, the equipment they have and the injuries they carry — and adjusts them session by session based on what they actually do.

The two words that matter are **real body**. Everything else is already being done by someone.

---

## 2. The four differentiators

### Adaptation to physical limitations

The person declares injuries, chronic conditions or mobility limitations, and the system filters, substitutes or adjusts exercises accordingly. It is the capability no competitor documents as a first-order property.

It rests on three technical foundations that make it possible and that aren't obvious from outside. The exercise catalogue is a versioned package with a taxonomy of movement patterns and a load matrix by body region, so substituting an exercise isn't a matter of finding another one that works the same muscle but one that respects the compromised region. The text of the limitation reaches the model but is masked before any observability trace, because it is health data. And the system produces **warnings and suggested substitutions, never a diagnosis or a clinical block**, a boundary written into the project's working contract and one that isn't merely legal caution: it is what makes it possible to offer the feature without pretending to be something it isn't.

### Two modes feeding the same structure

A plan is defined either through a seven-step card wizard, quick and visual, or by talking out loud. Both modes write to the same data structure, so you can switch between them without losing progress.

This matters because the two modes serve two different moments. Cards are better when you know what you want. Conversation is better when your situation has nuances no form captures — which is exactly the case for someone with an injury.

### Persistent memory, visible and erasable

The system remembers preferences, equipment, context and patterns across sessions. What sets it apart from memory in other products is that here **the person can view it, edit it and delete it**, and that memories are only created with explicit confirmation: automatic extraction from conversation was ruled out because of the risk of capturing raw transcripts and health data.

Less automatic coverage, in exchange for nobody being surprised by what the system knows about them.

### Logging that works without a signal

Set logging is designed for the real gym, where there's often no reception: three-state entry — under, met, over — with a local queue and sync once the connection is back. The queue distinguishes retriable failures from messages that must be discarded, and tells the user when it discards something instead of making it vanish silently.

---

## 3. What it competes against, honestly

Against **Fitbod and Freeletics**, which cost less or about the same, the advantage is adaptation for limitations and conversational plan definition. The disadvantage is that they are mature products with enormous catalogues and years of tuning behind them.

Against **SensAI**, which also uses a language model and also converses, the advantage is adaptation for limitations and the user's control over their own memory. The disadvantage is that it integrates sleep and heart rate variability signals that kInorA doesn't read.

Against **Future and Trainiac**, with human trainers, the advantage is price and latency: adaptation is immediate and doesn't depend on anyone's schedule. The disadvantage is obvious and shouldn't be glossed over: an algorithm does not replace the clinical judgement of a professional who watches you move.

**kInorA doesn't compete with the physiotherapist.** It competes with doing nothing, or with following a generic plan that ignores the injury.

---

## 4. User personas

### The person coming back from an injury

This is the central case. They have a goal, they have equipment, and they have a region they can't load. Generic plans only half work for them and a professional is too expensive. They need the plan to acknowledge the limitation without treating it as an illness.

**Journey:** defines the plan by conversation because their situation has nuances, declares the limitation, receives a plan with substitutions and warnings, trains, and gives feedback by body region after the adapted exercises.

### The person training at home with little equipment

They have a pair of dumbbells, a band and not much time. Most plans assume a fully equipped gym.

**Journey:** defines the plan with cards in two minutes, declares their equipment, and if an exercise turns out to be unworkable the system swaps it for an equivalent one.

### The long-time trainee who has plateaued

They know what they're doing and want progression, not motivation. What interests them is statistics, personal records and RPE-based adaptation.

**Journey:** logs precisely, reviews load progression per exercise, and the system proposes adjusting frequency based on adherence or intensity based on perceived effort, always with explicit confirmation.

### The trainer with clients

Manages several people and wants to deliver plans under their own brand without building infrastructure.

**Journey:** invites the client, creates plans on their behalf, reviews their progress. The client keeps their personal account and shares only training data with the trainer — never their billing, their credentials or their assistant memory.

### The gym

Wants to offer planning to its members under its own visual identity. This is served through white labelling: subdomain, logo and custom palette.

---

## 5. A property you don't see but do notice

There is one criterion running through the entire product that is worth stating as a value proposition, because that's what it is: **the system does not invent data**.

Plan days are numbered rather than assigned weekday names, because the model has no anchor to the calendar and manufacturing one would be misleading. An indicator that can't be computed is left empty instead of estimated. The weekly panel doesn't flag missed days or reproach absences. And when the system automatically closes a forgotten session, it doesn't record it as completed.

In a category full of inflated metrics and rings that close themselves, a product that prefers a blank to a made-up number holds a defensible position.

---

## 6. What it doesn't do today

It doesn't read wearables, sleep or heart rate variability. It doesn't do nutrition tracking. It doesn't correct technique from video. It doesn't replace a healthcare professional, and it says so.

And it doesn't send any email: account and billing flows have no email notification implemented, which is a real gap ahead of a launch and is captured in the [next steps](./next-steps.md).
