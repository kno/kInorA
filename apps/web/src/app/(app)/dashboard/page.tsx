import { getFirstParam, resolvePageI18n } from "@/i18n/request";
import { logoutAction } from "./actions";

/**
 * Dashboard — protected page only accessible with a valid session.
 *
 * The proxy (`proxy.ts`) gates this route: no `kinora_session`
 * cookie → redirect to `/login`. If you can see this page you are
 * authenticated (cookie present — full session validation delegated
 * to the API, 05b owns 401/403 reject policy).
 *
 * This page renders inside the AppShell provided by `(app)/layout.tsx`.
 *
 * User-facing copy comes from the i18n catalogs (see `@/i18n/locale`),
 * resolved from the `?lang=` query parameter or the `Accept-Language` header.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const { messages } = await resolvePageI18n(getFirstParam(params.lang));

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{messages.dashboard_title}</h1>
        <p className="kin-text kin-muted">{messages.dashboard_authenticated}</p>

        <form action={logoutAction}>
          <button type="submit" className="kin-btn kin-btn--danger">
            {messages.dashboard_logout}
          </button>
        </form>
      </div>
    </main>
  );
}
