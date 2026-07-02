import { cookies } from "next/headers";
import { getFirstParam, resolvePageI18n } from "@/i18n/request";
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
 * User-facing copy comes from the i18n catalogs (see `@/i18n/locale`), resolved
 * from the `?lang=` query parameter or the `Accept-Language` header, and passed
 * down to the client stepper as `messages`.
 */
export default async function CreatePlanPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const { messages } = await resolvePageI18n(getFirstParam(params.lang));

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const draft = await loadCurrentDraft(token);

  return (
    <StepperShell
      initialDraft={draft ?? undefined}
      saveDraftAction={saveDraftAction}
      confirmPlanSpecAction={confirmPlanSpecAction}
      messages={messages}
    />
  );
}
