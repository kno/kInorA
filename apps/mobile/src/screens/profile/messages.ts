/**
 * id-only descriptors for `ProfileScreen` (17c-profile-body-metrics, PR 5).
 * No `defaultMessage` — the shared `@kinora/i18n` catalog's `profile.*`
 * namespace (authored by PR 1/PR 2/PR 4 on the web side) is the single
 * source of truth for copy. Mobile does not read the shared catalog through
 * `next-intl` the way web does, but it resolves the SAME underlying JSON
 * (`resolveMessages` flattens `@kinora/i18n`'s `catalogs` for `IntlProvider`)
 * through `react-intl` instead — so these keys are reused, not re-authored,
 * mirroring `plan/messages.ts` reusing `wizard.goal.*.label` and
 * `adaptation.quotaExhausted`. No NEW catalog keys are needed for this
 * screen; every key below already shipped in PRs 1, 2 and 4.
 */

import { defineMessages } from "react-intl";

export const messages = defineMessages({
  heading: { id: "profile.form.heading" },
  loadError: { id: "profile.form.loadError" },
  nameLabel: { id: "profile.form.name" },
  namePlaceholder: { id: "profile.form.namePlaceholder" },
  nameRequired: { id: "profile.form.nameRequired" },
  goalLabel: { id: "profile.form.goal" },
  experienceLabel: { id: "profile.form.experience" },
  selfDescribedSexLabel: { id: "profile.form.selfDescribedSex.label" },
  heightCmLabel: { id: "profile.form.heightCm" },
  heightCmPlaceholder: { id: "profile.form.heightCmPlaceholder" },
  save: { id: "profile.form.save" },
  saving: { id: "profile.form.saving" },
  saved: { id: "profile.form.saved" },
  error: { id: "profile.form.error" },

  weightEntryHeading: { id: "profile.weightEntry.heading" },
  weightLabel: { id: "profile.weightEntry.weightLabel" },
  weightPlaceholder: { id: "profile.weightEntry.weightPlaceholder" },
  weightSubmit: { id: "profile.weightEntry.submit" },
  weightSaving: { id: "profile.weightEntry.saving" },
  invalidWeight: { id: "profile.weightEntry.invalidWeight" },
  invalidDate: { id: "profile.weightEntry.invalidDate" },
  weightError: { id: "profile.weightEntry.error" },
  listHeading: { id: "profile.weightEntry.listHeading" },
  listEmpty: { id: "profile.weightEntry.listEmpty" },

  volumeShiftNotice: { id: "profile.weight.volumeShiftNotice" },
  dismiss: { id: "profile.weight.dismiss" },
});
