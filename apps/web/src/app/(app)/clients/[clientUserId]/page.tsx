import { getLocale, getTranslations } from "next-intl/server";
import { getClientsAction } from "../actions";
import { loadClientDetailBody, normalizeTab } from "../client-detail-loader";
import { ClientDetailHeader, ClientDetailPendingNotice } from "./ClientDetailSections";

/**
 * Trainer client-detail page (GH #447, PR 2/2 — web). Built to
 * `web-clients.html`'s detail panel: identity header, Dashboard/Progress/Plan
 * tabs, all URL-driven (`?tab=&range=&exercise=&weekStart=`) so each tab is a
 * plain server-rendered read — no client-side tab-switching JS.
 *
 * Identity comes from `GET /trainer/clients` (already fetched by the list
 * page) rather than a new endpoint — that read is the only place the web app
 * learns a client's email/status. `forbidden` (not an entitled trainer) and
 * "this client isn't in your roster" (a real `clientUserId` the trainer just
 * isn't assigned to) are DISTINCT honest states, neither invented.
 */

interface ClientDetailPageProps {
  params: Promise<{ clientUserId: string }>;
  searchParams: Promise<{ tab?: string; range?: string; exercise?: string; weekStart?: string }>;
}

export default async function ClientDetailPage({ params, searchParams }: ClientDetailPageProps) {
  const { clientUserId } = await params;
  const sp = (await searchParams) ?? {};
  const tab = normalizeTab(sp.tab);
  const t = await getTranslations();

  const clientsResult = await getClientsAction();

  if (clientsResult.kind === "forbidden") {
    return (
      <main className="kin-page">
        <h1 className="kin-title">{t("clients.accessRestrictedTitle")}</h1>
        <p className="kin-text kin-muted">{t("clients.accessRestrictedBody")}</p>
      </main>
    );
  }

  if (clientsResult.kind === "error") {
    return (
      <main className="kin-page">
        <p className="kin-text" role="alert">
          {t("clients.loadError")}
        </p>
      </main>
    );
  }

  const client = clientsResult.clients.find((candidate) => candidate.clientUserId === clientUserId);
  if (!client) {
    return (
      <main className="kin-page">
        <p className="kin-text kin-muted" data-testid="client-detail-not-found">
          {t("clients.detail.notFound")}
        </p>
      </main>
    );
  }

  if (client.status !== "active") {
    return (
      <main className="kin-page" data-testid="client-detail-page">
        {ClientDetailHeader({ client, tab, t })}
        {ClientDetailPendingNotice({ t })}
      </main>
    );
  }

  const locale = await getLocale();
  const body = await loadClientDetailBody(clientUserId, tab, sp, t, undefined, locale);

  return (
    <main className="kin-page" data-testid="client-detail-page">
      {ClientDetailHeader({ client, tab, t })}
      {body}
    </main>
  );
}
