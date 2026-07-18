import type { Metadata, Viewport } from "next";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { SerwistProvider } from "@serwist/next/react";

import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#09090c",
};

export const metadata: Metadata = {
  title: "kInorA — Personalized Training",
  description: "Personalized training powered by AI",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "kInorA",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `getLocale`/`getMessages` read the SAME per-request config resolved by
  // `getRequestConfig` (src/i18n/request.ts) — using them here instead of
  // calling `resolveLocale` a second time keeps the `<html lang>` attribute
  // and the provider's messages from ever drifting apart on one request.
  const locale = await getLocale();
  const messages = await getMessages();

  // Serwist only emits `sw.js` in production builds (it is disabled in
  // development via next.config). Registering the worker outside production
  // requests a non-existent `/sw.js`, which 404s and surfaces as an
  // unhandledRejection that breaks the page. Gate registration to match.
  const serviceWorkerEnabled = process.env.NODE_ENV === "production";

  return (
    <html lang={locale}>
      <body>
        {/* Progressive enhancement: ensure reveal blocks are visible when JS is disabled */}
        <noscript>
          <style>{`.kin-landing-reveal{opacity:1;transform:none}`}</style>
        </noscript>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {serviceWorkerEnabled ? (
            <SerwistProvider swUrl="/sw.js">{children}</SerwistProvider>
          ) : (
            children
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}