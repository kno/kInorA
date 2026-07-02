import { getFirstParam, resolvePageI18n } from "@/i18n/request";

/**
 * Exercises (scaffold) — protected page rendered inside the AppShell.
 *
 * Placeholder content until the exercise library is implemented.
 *
 * User-facing copy comes from the i18n catalogs (see `@/i18n/locale`),
 * resolved from the `?lang=` query parameter or the `Accept-Language` header.
 */
export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const { messages } = await resolvePageI18n(getFirstParam(params.lang));

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{messages.exercises_title}</h1>
        <p className="kin-text kin-muted">{messages.exercises_description}</p>
      </div>
    </main>
  );
}
