/**
 * id-only descriptors for `PlansScreen` (17d PR C).
 *
 * The shared `@kinora/i18n` catalog is the single source of truth for this
 * copy: the `plans.*` namespace was authored on the web side by PRs A and B,
 * and mobile resolves the SAME JSON through `react-intl` (`resolveMessages`
 * flattens `@kinora/i18n`'s catalogs for `IntlProvider`). PR C therefore
 * REUSES those keys and adds no catalog key of its own — the convention
 * `screens/profile/messages.ts` and `screens/clients/messages.ts` document.
 * No `defaultMessage` anywhere: a local fallback string would be a second,
 * silently-diverging copy of text the catalog owns.
 *
 * ORDERING DEPENDENCY: the `plans.archive.*` and `plan.archived.badge` keys
 * are authored by 17d PR B (#403), which is still open. Until it merges,
 * those ids resolve to nothing and react-intl renders the id itself. The
 * fix is to merge #403 first — not to inline the strings here.
 */

import { defineMessages } from "react-intl";

export const messages = defineMessages({
  // ── PR A's `plans.*` list copy ──
  title: { id: "plans.title" },
  description: { id: "plans.description" },
  loadError: { id: "plans.error" },
  retry: { id: "planStatus.retry" },
  /** Generic "that action failed" copy, reused for a failed archive/unarchive. */
  actionError: { id: "planStatus.error" },
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

  // ── PR B's archive copy (#403) ──
  archiveAction: { id: "plans.archive.action" },
  /**
   * The confirm body is load-bearing, not decoration: it is where the user is
   * told that nothing is deleted. Archiving exists precisely because deleting
   * a plan would cascade through `workout_sessions` and erase every logged
   * workout — so this reassurance is rendered in full, never trimmed.
   */
  confirmTitle: { id: "plans.archive.confirmTitle" },
  confirmBody: { id: "plans.archive.confirmBody" },
  confirm: { id: "plans.archive.confirm" },
  cancel: { id: "plans.archive.cancel" },
  unarchiveAction: { id: "plans.archive.unarchiveAction" },
  /** Takes an ICU `{count}` — the number of archived plans. */
  showToggle: { id: "plans.archive.showToggle" },
  hideToggle: { id: "plans.archive.hideToggle" },
  archivedHeading: { id: "plans.archive.sectionHeading" },
  /** Note the namespace: `plan.archived.*`, not `plans.archive.*`. */
  archivedBadge: { id: "plan.archived.badge" },
});
