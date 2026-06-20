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
    <main
      style={{
        maxWidth: "100%",
        overflowX: "hidden",
        boxSizing: "border-box",
        padding: "2rem 1rem",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <h1
        style={{
          fontSize: "clamp(1.75rem, 5vw, 3rem)",
          margin: "0 0 0.5rem",
          textAlign: "center",
          lineHeight: 1.2,
        }}
      >
        {messages.title}
      </h1>
      <p
        style={{
          fontSize: "clamp(1rem, 2.5vw, 1.25rem)",
          margin: "0 0 1.5rem",
          textAlign: "center",
          lineHeight: 1.4,
          color: "#555",
        }}
      >
        {messages.subtitle}
      </p>
      <a
        href="#"
        style={{
          display: "inline-block",
          padding: "0.75rem 1.5rem",
          fontSize: "clamp(0.875rem, 2vw, 1rem)",
          backgroundColor: "#0070f3",
          color: "#fff",
          textDecoration: "none",
          borderRadius: "0.5rem",
          fontWeight: 600,
          lineHeight: 1.5,
        }}
      >
        {messages.cta}
      </a>
    </main>
  );
}