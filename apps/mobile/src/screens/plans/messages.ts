/**
 * id-only descriptors for `PlansScreen` (17d PR C).
 *
 * The shared `@kinora/i18n` catalog is the single source of truth for this
 * copy: the `plans.*` namespace was authored on the web side by PR A, and
 * mobile resolves the SAME JSON through `react-intl` (`resolveMessages`
 * flattens `@kinora/i18n`'s catalogs for `IntlProvider`). PR C therefore
 * REUSES those keys and adds no catalog key of its own — the convention
 * `screens/profile/messages.ts` and `screens/clients/messages.ts` document.
 *
 * The one exception is the `archive` group below. Those keys belong to
 * 17d PR B (task B.19), which is still in review and has not landed on
 * `main`; the ids here are the ones PR B is authoring. Each carries a
 * `defaultMessage` purely as a bridge, so this screen renders correct
 * English instead of a raw message id in the window before PR B merges.
 * Once the catalog keys exist they win automatically — react-intl prefers a
 * resolved message over `defaultMessage` — and the fallbacks can be dropped.
 */

import { defineMessages } from "react-intl";

export const messages = defineMessages({
  // ── Reused verbatim from the PR A `plans.*` catalog namespace ──
  title: { id: "plans.title" },
  description: { id: "plans.description" },
  loadError: { id: "plans.error" },
  retry: { id: "planStatus.retry" },
  emptyTitle: { id: "plans.empty.title" },
  emptyDesc: { id: "plans.empty.desc" },
  emptyCta: { id: "plans.empty.cta" },
  currentlyFollowing: { id: "plans.list.currentlyFollowing" },
  daysPerWeek: { id: "plans.list.daysPerWeek" },
  completedSessions: { id: "plans.list.completedSessions" },
  lastTrained: { id: "plans.list.lastTrained" },
  neverTrained: { id: "plans.list.neverTrained" },
  open: { id: "plans.list.open" },
  openDisabledGenerating: { id: "plans.list.openDisabled.generating" },
  openDisabledFailed: { id: "plans.list.openDisabled.failed" },

  // ── Authored by 17d PR B (task B.19); `defaultMessage` bridges until it lands ──
  archiveAction: { id: "plans.archive.action", defaultMessage: "Archive" },
  unarchiveAction: { id: "plans.archive.unarchive", defaultMessage: "Unarchive" },
  showArchived: { id: "plans.archive.showArchived", defaultMessage: "Show archived" },
  hideArchived: { id: "plans.archive.hideArchived", defaultMessage: "Hide archived" },
  archivedHeading: { id: "plans.archive.sectionHeading", defaultMessage: "Archived" },
  archivedBadge: { id: "plans.archive.badge", defaultMessage: "Archived" },
  historyPreserved: {
    id: "plans.archive.historyPreserved",
    defaultMessage: "Archiving hides the plan. Your workout history is kept.",
  },
  actionError: {
    id: "plans.archive.error",
    defaultMessage: "Couldn't update that plan. Please try again.",
  },
});
