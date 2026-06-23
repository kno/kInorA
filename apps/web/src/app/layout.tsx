import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { resolveLocale } from "@/i18n/locale";
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
  const requestHeaders = await headers();
  const acceptLanguage = requestHeaders.get("accept-language");
  const locale = resolveLocale(acceptLanguage, undefined);

  return (
    <html lang={locale}>
      <body>
        <SerwistProvider swUrl="/sw.js">{children}</SerwistProvider>
      </body>
    </html>
  );
}