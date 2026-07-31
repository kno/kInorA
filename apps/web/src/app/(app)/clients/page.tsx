import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchClients } from "./trainer-client";
import { inviteClientAction } from "./actions";
import { ClientListClient } from "./ClientListClient";

/**
 * Trainer client-list page (15a-v2-trainer-account-access, Slice 5).
 *
 * Gating: the web app has no client-visible `role`/`tier` today (see the S5
 * apply-progress deviation note), so this page relies on the EXISTING
 * server-side enforcement — `GET /trainer/clients` is gated by
 * `requireRole("trainer")` + the trainer entitlement check (S2/S3). A `403`
 * is the one signal available and is treated as "not an entitled trainer",
 * rendering an access-restricted message instead of the list. Any OTHER
 * fetch error is forwarded to `ClientListClient` as `initialError` so it can
 * render its existing error state (mirrors `MemoryPage`).
 */
export default async function ClientsPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await fetchClients(token);

  if (result.kind === "forbidden") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("clients.accessRestrictedTitle")}</h1>
        <p className="kin-text kin-muted">{t("clients.accessRestrictedBody")}</p>
      </main>
    );
  }

  const initialClients = result.kind === "ok" ? result.clients : [];
  const initialError = result.kind === "error" ? result.message : null;

  return (
    <ClientListClient
      initialClients={initialClients}
      initialError={initialError}
      inviteClientAction={inviteClientAction}
    />
  );
}
