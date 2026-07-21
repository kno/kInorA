## Exploration: Exercise title as heading on exercises page

### Current State

The exercises page at `apps/web/src/app/(app)/exercises/page.tsx` renders two sections:

1. A static card with `<h1>Exercises</h1>` and a description — always visible.
2. A history-of-recent-sets card (`data-testid="exercise-history"`) with an `<h2>Recent history</h2>` and a table — only visible when `?title=` is provided AND the exercise has at least one completed set.

The page fetches `ExerciseDetailDTO` via `getExerciseDetailAction(title)`, which returns `{ exerciseTitle: string, recentSets: [...] }`. However, **the `exerciseTitle` value is never rendered** — it's only used to determine whether `recentSets` has entries and passed through to the test assertions. The test at `page.test.tsx:71` already passes `exerciseTitle: "Bench Press"` but never asserts the title appears in the rendered output.

This means when a user navigates to `exercises?title=Bench%20Press`, they see the generic "Exercises / Browse the exercise library" heading and a "Recent history" table, but **nowhere does it say "Bench Press"** — the name of the exercise they selected is invisible.

### Affected Areas

- `apps/web/src/app/(app)/exercises/page.tsx` — The server component needs to render `detailResult.detail.exerciseTitle` when the detail data is available.
- `packages/i18n/src/messages/en.json` — Needs a new i18n key if the exercise title is wrapped in a label (e.g., "Exercise: {title}").
- `packages/i18n/src/messages/es.json` — Same key in Spanish, required by catalog-parity enforcement.
- `apps/web/src/app/(app)/exercises/__tests__/page.test.tsx` — Existing tests need new assertions that the exercise title appears as a heading when history exists.

### Approaches

1. **Add the exercise title directly inside the history card** — Simplest change. Within the existing `<div className="kin-card" data-testid="exercise-history">`, render the `exerciseTitle` as an `<h3>` or as part of the `<h2>` heading (e.g., replace `<h2>{t("exercises.history.title")}</h2>` with `<h2>{exerciseTitle}</h2>` and keep "Recent history" as a subtitle or remove it).
   - Pros: Minimal code change, no new layout elements, reuses existing card structure. The `exerciseTitle` is already available in scope.
   - Cons: Sacrifices the "Recent history" label or adds nesting. If "Recent history" becomes a subtitle, the heading hierarchy changes.
   - Effort: Low

2. **New heading element inside the history card, preserving "Recent history"** — Keep the `<h2>Recent history</h2>` and add the exercise title as an `<h2>` or `<h3>` above it, or inside the same card as a caption/label.
   - Pros: Preserves all existing copy. Clear semantic heading for the exercise.
   - Cons: Two heading-level elements in one card could feel cluttered. Needs a new i18n key for the label (e.g., `exercises.detail.title`).
   - Effort: Low

3. **Separate card for exercise title** — Create a new card above the history card that shows the exercise title as the heading, with the history card remaining unchanged below it.
   - Pros: Clean separation of concerns. No ambiguity about what the title refers to. Matches the described spec intent ("exercise detail").
   - Cons: More DOM nodes, another `kin-card` block. The page already has a card with the page title — three cards might feel heavy for a page that's still a scaffold.
   - Effort: Low

### Recommendation

**Approach 1** is the pragmatic choice — replace the `<h2>Recent history</h2>` inside the history card with the exercise title itself, and demote "Recent history" to an accessible label or remove it since the context already says what it is. However, this loses the "Recent history" label that may be useful for users.

After looking more closely at the component, **Approach 2** is actually the best balance: keep `<h2>{t("exercises.history.title")}</h2>` and add the exercise title as a **visible heading above it** within the same card, using a new i18n key pattern like `exercises.detail.heading`. The exercise title should be the most prominent text in the history section, with "Recent history" as a section label.

Specifically: Add `<h3 className="kin-title">{detailResult.detail.exerciseTitle}</h3>` above the existing `<h2>` inside the history card, plus a new i18n key `exercises.history.subtitle` if a label prefix is desired. But since the exercise name is self-explanatory, rendering it as-is is sufficient — similar to how `ExerciseCard.tsx` in the tracker renders `{activeExercise?.title}` without a prefix label.

### Ready for Proposal

Yes. The change is small and well-understood. The orchestrator should tell the user:

> The exploration confirms issue #141 is a small, focused front-end change. The `exerciseTitle` is already fetched and available in the exercises page but never rendered. The implementation needs:
> - Add the exercise title as an `<h3>` heading inside the history card
> - Update the page test to assert the title renders
> - Update both i18n catalogs if a new key is introduced
>
> The change only touches 1 component file + its test + the i18n packages. Proposal can move forward.
