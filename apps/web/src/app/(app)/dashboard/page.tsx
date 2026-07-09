import { getTranslations } from "next-intl/server";
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
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose
 * locale is resolved from the `?lang=` query parameter (via the
 * `x-kinora-lang` header injected by `proxy.ts`) or the `Accept-Language`
 * header.
 */
export default async function DashboardPage() {
  const t = await getTranslations();

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{t("dashboard.title")}</h1>
        <p className="kin-text kin-muted">{t("dashboard.authenticated")}</p>

        <form action={logoutAction}>
          <button type="submit" className="kin-btn kin-btn--danger">
            {t("dashboard.logout")}
          </button>
        </form>
      </div>
    </main>
  );
}
