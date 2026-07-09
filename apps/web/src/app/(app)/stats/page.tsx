import { getTranslations } from "next-intl/server";

/**
 * Statistics (scaffold) — protected page rendered inside the AppShell.
 *
 * Placeholder content until stats and analytics are implemented.
 *
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose
 * locale is resolved from the `?lang=` query parameter (via the
 * `x-kinora-lang` header injected by `proxy.ts`) or the `Accept-Language`
 * header.
 */
export default async function StatsPage() {
  const t = await getTranslations();

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{t("stats.title")}</h1>
        <p className="kin-text kin-muted">{t("stats.description")}</p>
      </div>
    </main>
  );
}
