import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchClients } from "./trainer-client";
import { inviteClientAction } from "./actions";
import { loadClientDetailBody, normalizeTab, type ClientDetailSearchParams } from "./client-detail-loader";
import { ClientDetailHeader, ClientDetailPendingNotice } from "./[clientUserId]/ClientDetailSections";
import { ClientsWorkspaceClient } from "./ClientsWorkspaceClient";

/**
 * Trainer client-list page (15a-v2-trainer-account-access, Slice 5; rebuilt
 * for the GH #447 workspace closeout into `web-clients.html`'s two-column
 * master-detail: the roster on the left, the SELECTED client's Dashboard/
 * Progress/Plan detail on the right, on this same page — `?client=` (default:
 * the first client) and `?tab=/range=/exercise=/weekStart=` drive it, exactly
 * like the standalone `/clients/[clientUserId]` route this reuses
 * (`ClientDetailHeader` + `loadClientDetailBody`, both parameterised by
 * `hrefBase` so the SAME building blocks render either route's links).
 *
 * The standalone route keeps working unchanged — deep links from quick
 * actions and the narrow-viewport fallback both need it (see
 * `ClientsWorkspaceClient`'s `useIsDesktop`).
 *
 * Gating: the web app has no client-visible `role`/`tier` today (see the S5
 * apply-progress deviation note), so this page relies on the EXISTING
 * server-side enforcement — `GET /trainer/clients` is gated by
 * `requireRole("trainer")` + the trainer entitlement check (S2/S3). A `403`
 * is the one signal available and is treated as "not an entitled trainer",
 * rendering an access-restricted message instead of the list. Any OTHER
 * fetch error is forwarded to `ClientsWorkspaceClient` as `initialError` so it
 * can render its existing error state (mirrors `MemoryPage`).
 */

interface ClientsPageProps {
  searchParams: Promise<{ client?: string } & ClientDetailSearchParams>;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const sp = (await searchParams) ?? {};

  const result = await fetchClients(token);

  if (result.kind === "forbidden") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("clients.accessRestrictedTitle")}</h1>
        <p className="kin-text kin-muted">{t("clients.accessRestrictedBody")}</p>
      </main>
    );
  }

  const clients = result.kind === "ok" ? result.clients : [];
  const initialError = result.kind === "error" ? result.message : null;

  const selectedClientUserId = sp.client ?? clients[0]?.clientUserId;
  const selectedClient = selectedClientUserId
    ? clients.find((candidate) => candidate.clientUserId === selectedClientUserId)
    : undefined;
  const detailNotFound = Boolean(selectedClientUserId) && !selectedClient;

  let detailHeader: ReactNode;
  let detailBody: ReactNode;

  if (selectedClient) {
    const tab = normalizeTab(sp.tab);
    const hrefBase = `/clients?client=${selectedClient.clientUserId}`;
    detailHeader = ClientDetailHeader({ client: selectedClient, tab, t, hrefBase });
    if (selectedClient.status !== "active") {
      detailBody = ClientDetailPendingNotice({ t });
    } else {
      const locale = await getLocale();
      detailBody = await loadClientDetailBody(selectedClient.clientUserId, tab, sp, t, hrefBase, locale);
    }
  }

  return (
    <ClientsWorkspaceClient
      clients={clients}
      initialError={initialError}
      selectedClientUserId={selectedClient?.clientUserId}
      detailHeader={detailHeader}
      detailBody={detailBody}
      detailNotFound={detailNotFound}
      inviteClientAction={inviteClientAction}
    />
  );
}
