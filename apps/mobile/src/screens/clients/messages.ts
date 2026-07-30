/**
 * id-only descriptors for `ClientListScreen` / `ClientCreatePlanScreen`
 * (15a-v2-trainer-account-access Track C — mobile trainer surface). No
 * `defaultMessage` — the shared `@kinora/i18n` catalog's `clients.*`
 * namespace is the single source of truth for copy (EN/ES parity enforced by
 * the i18n parity test). Mirrors `plan/messages.ts`.
 */

import { defineMessages } from "react-intl";

export const messages = defineMessages({
  pageTitle: { id: "clients.pageTitle" },
  loadingLabel: { id: "clients.loadingLabel" },
  retryLabel: { id: "clients.retryLabel" },
  loadError: { id: "clients.loadError" },
  emptyState: { id: "clients.emptyState" },
  accessRestrictedTitle: { id: "clients.accessRestrictedTitle" },
  accessRestrictedBody: { id: "clients.accessRestrictedBody" },
  inviteTitle: { id: "clients.inviteTitle" },
  inviteEmailLabel: { id: "clients.inviteEmailLabel" },
  inviteSubmit: { id: "clients.inviteSubmit" },
  inviteSuccess: { id: "clients.inviteSuccess" },
  inviteErrorAlreadyAssigned: { id: "clients.inviteErrorAlreadyAssigned" },
  inviteErrorNotFound: { id: "clients.inviteErrorNotFound" },
  inviteErrorGeneric: { id: "clients.inviteErrorGeneric" },
  createPlanCta: { id: "clients.createPlanCta" },
  statusInvited: { id: "clients.status.invited" },
  statusActive: { id: "clients.status.active" },
  statusRevoked: { id: "clients.status.revoked" },
  createPlanTitle: { id: "clients.createPlan.title" },
  createPlanGoalLabel: { id: "clients.createPlan.goalLabel" },
  createPlanDaysPerWeekLabel: { id: "clients.createPlan.daysPerWeekLabel" },
  createPlanSessionDurationLabel: { id: "clients.createPlan.sessionDurationLabel" },
  createPlanLocationLabel: { id: "clients.createPlan.locationLabel" },
  createPlanSubmit: { id: "clients.createPlan.submit" },
  createPlanSubmitting: { id: "clients.createPlan.submitting" },
  createPlanErrorGeneric: { id: "clients.createPlan.errorGeneric" },
  createPlanErrorForbidden: { id: "clients.createPlan.errorForbidden" },
});
