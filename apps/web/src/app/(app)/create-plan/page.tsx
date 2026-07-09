import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { StepperShell } from "./StepperShell";
import { loadCurrentDraft } from "./plan-draft-client";
import { saveDraftAction, confirmPlanSpecAction } from "./actions";

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
  const draft = await loadCurrentDraft(token);

  return (
    <StepperShell
      initialDraft={draft ?? undefined}
      saveDraftAction={saveDraftAction}
      confirmPlanSpecAction={confirmPlanSpecAction}
    />
  );
}
