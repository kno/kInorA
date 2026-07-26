/**
 * id-only descriptors for `PlanStatusScreen` (14a Track C2). No
 * `defaultMessage` — the shared `@kinora/i18n` catalog's `planStatus.*`
 * namespace is the single source of truth for copy (EN/ES parity enforced by
 * the i18n parity test). Mirrors `tracker/messages.ts`.
 *
 * The 403 quota-exhausted notice deliberately reuses the existing
 * `adaptation.quotaExhausted` copy (shipped in B2) so the regenerate and the
 * D1 adherence-adapt surfaces speak with one voice about a spent plan change.
 */

import { defineMessages } from "react-intl";

export const messages = defineMessages({
  loading: { id: "planStatus.loading" },
  generatingTitle: { id: "planStatus.generatingTitle" },
  generatingBody: { id: "planStatus.generatingBody" },
  readyTitle: { id: "planStatus.readyTitle" },
  readySessions: { id: "planStatus.readySessions" },
  failedTitle: { id: "planStatus.failedTitle" },
  failedBody: { id: "planStatus.failedBody" },
  regenerate: { id: "planStatus.regenerate" },
  regenerating: { id: "planStatus.regenerating" },
  retry: { id: "planStatus.retry" },
  error: { id: "planStatus.error" },
  quotaExhausted: { id: "adaptation.quotaExhausted" },
  stalledTitle: { id: "planStatus.stalledTitle" },
  stalledBody: { id: "planStatus.stalledBody" },
  refresh: { id: "planStatus.refresh" },
});
