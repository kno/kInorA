import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchUserProfile } from "../profile/profile-form-client";
import { getBillingVisibility } from "../billing/billing-client";
import { CreatePlanShell } from "./CreatePlanShell";
import { loadCurrentDraft } from "./plan-draft-client";
import { fetchUserPreferences } from "./preferences-client";
import {
  saveDraftAction,
  confirmPlanSpecAction,
  saveUserPreferencesAction,
} from "./actions";

/**
 * Create Plan — protected server component.
 *
 * Hydrates the wizard from the user's current server draft (resume) when one
 * exists, then renders the client stepper wired to the Server Actions. The
 * wizard's only output is a confirmed PlanSpec — no workout program (08).
 *
 * User-facing copy is resolved via next-intl (`getRequestConfig`, wired in
 * #100 slice 3) from the `x-kinora-lang` header/`Accept-Language`; the
 * stepper and its steps consume the catalog themselves via `useTranslations`
 * (no `messages` prop threading).
 */
export default async function CreatePlanPage() {
  await getTranslations();

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const [draft, profileResult, preferencesResult, visibility] = await Promise.all([
    loadCurrentDraft(token),
    fetchUserProfile(token),
    fetchUserPreferences(token),
    getBillingVisibility(token),
  ]);

  // Effective tier is resolved SERVER-SIDE (reusing the 11b billing-visibility
  // read, whose `billing.tier` is already the `resolveEffectiveTier` result) —
  // never trusted from the client. Pro defaults to Asistente; Free to the
  // Formulario wizard + an Asistente teaser. The default is cosmetic: the API's
  // 403 Pro gate is the real enforcement.
  const isPro = visibility.kind === "ok" && visibility.data.billing.tier === "pro";

  return (
    <CreatePlanShell
      defaultMode={isPro ? "asistente" : "formulario"}
      isPro={isPro}
      upgradePath="/billing#pro-card"
      initialDraft={draft ?? undefined}
      initialProfile={profileResult.kind === "ok" ? profileResult.profile : null}
      initialPreferences={preferencesResult.kind === "ok" ? preferencesResult.preferences : null}
      saveDraftAction={saveDraftAction}
      saveUserPreferencesAction={saveUserPreferencesAction}
      confirmPlanSpecAction={confirmPlanSpecAction}
    />
  );
}
