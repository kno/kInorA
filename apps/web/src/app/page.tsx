import { resolveLocale, loadMessages } from "@/i18n/locale";
import { headers } from "next/headers";
import type { SupportedLocale } from "@/i18n/locale";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const langParam =
    typeof params.lang === "string"
      ? params.lang
      : Array.isArray(params.lang)
        ? params.lang[0] ?? null
        : null;

  const requestHeaders = await headers();
  const acceptLanguage = requestHeaders.get("accept-language");

  const locale: SupportedLocale = resolveLocale(acceptLanguage, langParam);
  const messages = loadMessages(locale);

  return (
    <main className="kin-page">
      <div className="kin-hero">
        <h1 className="kin-hero__title">{messages.title}</h1>
        <p className="kin-hero__subtitle">{messages.subtitle}</p>
        <a href="#" className="kin-btn kin-btn--accent">
          {messages.cta}
        </a>
      </div>
    </main>
  );
}