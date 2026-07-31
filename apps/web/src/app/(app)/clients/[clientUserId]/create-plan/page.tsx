import { createPlanForClientAction } from "../../actions";
import { CreatePlanForClientForm } from "./CreatePlanForClientForm";

/**
 * Create-plan-for-client page (15a-v2-trainer-account-access, Slice 5).
 * `:clientUserId` is authorized SERVER-SIDE by `resolveAuthorizedOwner` inside
 * `POST /clients/:clientUserId/plan-specs` (S4) — a non-assigned/non-trainer
 * caller submitting this form gets a 403 from the action, surfaced inline by
 * `CreatePlanForClientForm`; this page performs no separate authorization
 * check of its own.
 */
export default async function CreatePlanForClientPage({
  params,
}: {
  params: Promise<{ clientUserId: string }>;
}) {
  const { clientUserId } = await params;

  return (
    <CreatePlanForClientForm
      clientUserId={clientUserId}
      createPlanForClientAction={createPlanForClientAction}
    />
  );
}
