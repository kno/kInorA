import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { AppShell } from "@/components/AppShell/AppShell";
import type { SidebarUser } from "@/components/AppShell/SidebarNav";
import { fetchProfile } from "./auth/profile-client";

/**
 * (app) route group layout — renders the responsive AppShell around all
 * authenticated pages.
 *
 * This layout is a server component that resolves the authenticated user's
 * profile and threads it to the AppShell so the sidebar can display real
 * identity data instead of a placeholder fallback.
 *
 * The proxy (`proxy.ts`) gates all `(app)` routes: reaching this layout
 * implies a valid session exists. The shell does NOT re-check auth.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  let user: SidebarUser | undefined;
  if (token) {
    const profile = await fetchProfile(token);
    if (profile) {
      user = {
        initials: profile.initials,
        name: profile.email,
        plan: "Free",
      };
    }
  }

  return (
    <AppShell
      user={user}
      memoryNavLabel={t("memory.navLabel")}
      billingNavLabel={t("billing.navLabel")}
    >
      {children}
    </AppShell>
  );
}
