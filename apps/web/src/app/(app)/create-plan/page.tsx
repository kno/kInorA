import { cookies } from "next/headers";
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
 */
export default async function CreatePlanPage() {
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
