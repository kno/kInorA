import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { resolveLocale } from "@/i18n/locale";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "kInorA — Personalized Training",
  description: "Personalized training powered by AI",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const acceptLanguage = requestHeaders.get("accept-language");
  const locale = resolveLocale(acceptLanguage, undefined);

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}