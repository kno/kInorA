import { AppShell } from "@/components/AppShell/AppShell";

/**
 * (app) route group layout — renders the responsive AppShell around all
 * authenticated pages.
 *
 * This layout is NOT marked `'use client'` — it is a server component
 * that wraps children in the client-side AppShell. The AppShell handles
 * viewport detection, responsive sidebar/mobile-nav, and client-side
 * active route highlighting.
 *
 * The proxy (`proxy.ts`) gates all `(app)` routes: reaching this layout
 * implies a valid session exists. The shell does NOT re-check auth.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
