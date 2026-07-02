import { getFirstParam, resolvePageI18n } from "@/i18n/request";

/**
 * Profile (scaffold) — protected page rendered inside the AppShell.
 *
 * Placeholder content until full profile management is implemented.
 *
 * User-facing copy comes from the i18n catalogs (see `@/i18n/locale`),
 * resolved from the `?lang=` query parameter or the `Accept-Language` header.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const { messages } = await resolvePageI18n(getFirstParam(params.lang));

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{messages.profile_title}</h1>
        <p className="kin-text kin-muted">{messages.profile_description}</p>
      </div>
    </main>
  );
}
